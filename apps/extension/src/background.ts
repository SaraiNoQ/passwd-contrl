import type {
  AcknowledgeSimilarOriginRequest,
  FillMatchedCredentialRequest,
  FormCandidatesMessage,
  GetExtensionStatusRequest,
  MatchedCredentialDisplay,
  PopupStateRequest,
  PopupStateResponse,
  VaultCredentialSessionItem,
  VaultSessionMessage
} from "./messages";
import { classifyAllMatches, isHttpsOrigin, normalizeOrigin } from "./origin-matching";

type CandidateState = {
  tabId: number;
  origin: string;
  forms: FormCandidatesMessage["forms"];
  detectedAt: string;
};

const CANDIDATE_KEY = "lastCandidate";
const SESSION_CREDENTIALS_KEY = "sessionCredentials";
const ACKNOWLEDGED_ORIGINS_KEY = "acknowledgedOrigins";

const EXTENSION_VERSION = "0.1.0";

const getSessionCredentials = async (): Promise<VaultCredentialSessionItem[]> => {
  const stored = await chrome.storage.session.get(SESSION_CREDENTIALS_KEY);
  return (stored[SESSION_CREDENTIALS_KEY] as VaultCredentialSessionItem[] | undefined) ?? [];
};

const getCandidate = async (): Promise<CandidateState | null> => {
  const stored = await chrome.storage.session.get(CANDIDATE_KEY);
  return (stored[CANDIDATE_KEY] as CandidateState | undefined) ?? null;
};

const getAcknowledgedOrigins = async (): Promise<string[]> => {
  const stored = await chrome.storage.session.get(ACKNOWLEDGED_ORIGINS_KEY);
  return (stored[ACKNOWLEDGED_ORIGINS_KEY] as string[] | undefined) ?? [];
};

const getActiveTab = async (): Promise<chrome.tabs.Tab | null> => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
};

const originFromTab = (tab: chrome.tabs.Tab | null): string | null => {
  if (!tab?.url) {
    return null;
  }

  try {
    return new URL(tab.url).origin;
  } catch {
    return null;
  }
};

const popupState = async (): Promise<PopupStateResponse> => {
  const [candidate, activeTab, acknowledged] = await Promise.all([
    getCandidate(),
    getActiveTab(),
    getAcknowledgedOrigins()
  ]);
  const activeOrigin = originFromTab(activeTab);
  if (!activeOrigin || !isHttpsOrigin(activeOrigin)) {
    const response: PopupStateResponse = { blockedReason: "Zero Vault 仅支持 HTTPS 页面", credentials: [] };
    if (activeOrigin) {
      response.origin = activeOrigin;
    }
    return response;
  }
  if (!candidate) {
    return { origin: activeOrigin, blockedReason: "当前页面未检测到登录表单", credentials: [] };
  }
  if (candidate.tabId !== activeTab?.id || normalizeOrigin(candidate.origin) !== normalizeOrigin(activeOrigin)) {
    return { origin: activeOrigin, blockedReason: "当前页面未检测到登录表单", credentials: [] };
  }

  const credentials = await getSessionCredentials();
  const classified = classifyAllMatches(activeOrigin, credentials);

  // Build display list: exact + acknowledged similar. Suspicious are always excluded from fill.
  const displayCredentials: MatchedCredentialDisplay[] = [];
  const originKey = normalizeOrigin(activeOrigin);

  for (const c of classified) {
    if (c.matchType === "exact") {
      const { password: _password, ...rest } = c;
      displayCredentials.push({ ...rest, matchType: "exact" });
    } else if (c.matchType === "similar") {
      const { password: _password, ...rest } = c;
      displayCredentials.push({ ...rest, matchType: "similar" });
    } else if (c.matchType === "suspicious") {
      const { password: _password, ...rest } = c;
      displayCredentials.push({ ...rest, matchType: "suspicious" });
    }
  }

  const response: PopupStateResponse = {
    origin: activeOrigin,
    credentials: displayCredentials
  };

  if (displayCredentials.length === 0) {
    response.blockedReason = "没有匹配的凭据";
  }

  return response;
};

/**
 * Resolve credentials for a fill request. Validates origin match type and acknowledged status.
 */
const resolveFillCredential = async (
  credentialId: string
): Promise<{ ok: true; credential: VaultCredentialSessionItem } | { ok: false; error: string }> => {
  const [candidate, credentials, activeTab] = await Promise.all([
    getCandidate(),
    getSessionCredentials(),
    getActiveTab()
  ]);
  const activeOrigin = originFromTab(activeTab);
  if (!candidate || !activeOrigin || candidate.tabId !== activeTab?.id) {
    return { ok: false, error: "no_candidate" };
  }

  const credential = credentials.find((item) => item.id === credentialId);
  if (!credential) {
    return { ok: false, error: "origin_mismatch" };
  }

  // Check origin match type first (handles similar/suspicious/different)
  const { classifyOriginMatch } = await import("./origin-matching");
  const matchType = classifyOriginMatch(activeOrigin, credential.origin);

  if (matchType === "different") {
    return { ok: false, error: "origin_mismatch" };
  }

  if (matchType === "suspicious") {
    return { ok: false, error: "suspicious_origin" };
  }

  if (matchType === "similar") {
    const acknowledged = await getAcknowledgedOrigins();
    const ackKey = `${credentialId}:${normalizeOrigin(activeOrigin)}`;
    if (!acknowledged.includes(ackKey)) {
      return { ok: false, error: "similar_origin_not_acknowledged" };
    }
  }

  // "exact" and acknowledged "similar" pass through
  return { ok: true, credential };
};

chrome.runtime.onMessage.addListener(
  (
    message:
      | FormCandidatesMessage
      | PopupStateRequest
      | FillMatchedCredentialRequest
      | AcknowledgeSimilarOriginRequest
      | GetExtensionStatusRequest,
    sender,
    sendResponse
  ) => {
    if (message.type === "FORM_CANDIDATES") {
      if (!sender.tab?.id || !message.origin.startsWith("https://")) {
        return false;
      }

      chrome.storage.session.set({
        [CANDIDATE_KEY]: {
          tabId: sender.tab.id,
          origin: message.origin,
          forms: message.forms,
          detectedAt: new Date().toISOString()
        }
      });
      return false;
    }

    if (message.type === "GET_POPUP_STATE") {
      popupState().then(sendResponse);
      return true;
    }

    if (message.type === "FILL_MATCHED_CREDENTIAL") {
      resolveFillCredential(message.credentialId).then((result) => {
        if (!result.ok) {
          sendResponse(result);
          return;
        }
        const candidate = getCandidate();
        candidate.then((c) => {
          if (!c) {
            sendResponse({ ok: false, error: "no_candidate" });
            return;
          }
          chrome.tabs.sendMessage(c.tabId, {
            type: "FILL_CREDENTIAL",
            username: result.credential.username,
            password: result.credential.password
          });
          sendResponse({ ok: true });
        });
      });
      return true;
    }

    if (message.type === "ACKNOWLEDGE_SIMILAR_ORIGIN") {
      getAcknowledgedOrigins().then(async (acknowledged) => {
        const [candidate, activeTab] = await Promise.all([getCandidate(), getActiveTab()]);
        const activeOrigin = originFromTab(activeTab);
        if (!candidate || !activeOrigin || candidate.tabId !== activeTab?.id) {
          sendResponse({ ok: false });
          return;
        }
        const ackKey = `${message.credentialId}:${normalizeOrigin(activeOrigin)}`;
        if (!acknowledged.includes(ackKey)) {
          acknowledged.push(ackKey);
          await chrome.storage.session.set({ [ACKNOWLEDGED_ORIGINS_KEY]: acknowledged });
        }
        sendResponse({ ok: true });
      });
      return true;
    }

    if (message.type === "GET_EXTENSION_STATUS") {
      getSessionCredentials().then(async (credentials) => {
        const [candidate, activeTab] = await Promise.all([getCandidate(), getActiveTab()]);
        const activeOrigin = originFromTab(activeTab);
        let matchedCount = 0;
        if (candidate && activeTab?.id && activeOrigin && candidate.tabId === activeTab.id) {
          const classified = classifyAllMatches(activeOrigin, credentials);
          matchedCount = classified.filter((c) => c.matchType === "exact").length;
        }
        sendResponse({
          installed: true,
          version: EXTENSION_VERSION,
          credentialsLoaded: credentials.length > 0,
          matchedCredentials: matchedCount
        });
      });
      return true;
    }

    return false;
  }
);

chrome.runtime.onMessageExternal.addListener(
  (
    message:
      | VaultSessionMessage
      | { type: "GET_POPUP_STATE" }
      | FillMatchedCredentialRequest
      | { type: "SET_TEST_CREDENTIALS"; credentials: VaultCredentialSessionItem[] }
      | { type: "CLEAR_TEST_CREDENTIALS" }
      | GetExtensionStatusRequest,
    _sender,
    sendResponse
  ) => {
    if (message.type === "ZERO_VAULT_SESSION_UPDATE") {
      chrome.storage.session.set({ [SESSION_CREDENTIALS_KEY]: message.credentials }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "ZERO_VAULT_SESSION_CLEAR" || message.type === "CLEAR_TEST_CREDENTIALS") {
      Promise.all([
        chrome.storage.session.remove(SESSION_CREDENTIALS_KEY),
        chrome.storage.session.remove(CANDIDATE_KEY),
        chrome.storage.session.remove(ACKNOWLEDGED_ORIGINS_KEY)
      ]).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "SET_TEST_CREDENTIALS") {
      chrome.storage.session.set({ [SESSION_CREDENTIALS_KEY]: message.credentials }).then(() => sendResponse({ ok: true }));
      return true;
    }
    if (message.type === "GET_POPUP_STATE") {
      popupState().then(sendResponse);
      return true;
    }
    if (message.type === "FILL_MATCHED_CREDENTIAL") {
      resolveFillCredential(message.credentialId).then((result) => {
        if (!result.ok) {
          sendResponse(result);
          return;
        }
        getCandidate().then((c) => {
          if (!c) {
            sendResponse({ ok: false, error: "no_candidate" });
            return;
          }
          chrome.tabs.sendMessage(c.tabId, {
            type: "FILL_CREDENTIAL",
            username: result.credential.username,
            password: result.credential.password
          });
          sendResponse({ ok: true });
        });
      });
      return true;
    }
    if (message.type === "GET_EXTENSION_STATUS") {
      getSessionCredentials().then(async (credentials) => {
        const [candidate, activeTab] = await Promise.all([getCandidate(), getActiveTab()]);
        const activeOrigin = originFromTab(activeTab);
        let matchedCount = 0;
        if (candidate && activeTab?.id && activeOrigin && candidate.tabId === activeTab.id) {
          const classified = classifyAllMatches(activeOrigin, credentials);
          matchedCount = classified.filter((c) => c.matchType === "exact").length;
        }
        sendResponse({
          installed: true,
          version: EXTENSION_VERSION,
          credentialsLoaded: credentials.length > 0,
          matchedCredentials: matchedCount
        });
      });
      return true;
    }
    return false;
  }
);
