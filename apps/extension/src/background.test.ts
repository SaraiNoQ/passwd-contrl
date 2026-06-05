import { beforeEach, describe, expect, it, vi } from "vitest";

type RuntimeListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

const credential = {
  id: "credential-1",
  title: "Example",
  origin: "https://example.com",
  username: "alice@example.com",
  password: "correct horse battery staple"
};

const similarCredential = {
  id: "credential-similar",
  title: "Sub Example",
  origin: "https://sub.example.com",
  username: "bob@example.com",
  password: "another secret"
};

const suspiciousCredential = {
  id: "credential-suspicious",
  title: "Phish",
  origin: "https://xn--googl-e4d.com",
  username: "victim@google.com",
  password: "stolen"
};

let runtimeListeners: RuntimeListener[];
let externalListeners: RuntimeListener[];
let sessionStorage: Record<string, unknown>;
let sentTabMessages: Array<{ tabId: number; message: unknown }>;
let activeTab: chrome.tabs.Tab;

const installChromeMock = () => {
  runtimeListeners = [];
  externalListeners = [];
  sessionStorage = {};
  sentTabMessages = [];
  activeTab = { id: 42, url: "https://example.com/login" } as chrome.tabs.Tab;

  globalThis.chrome = {
    runtime: {
      onMessage: {
        addListener: vi.fn((listener: RuntimeListener) => {
          runtimeListeners.push(listener);
        })
      },
      onMessageExternal: {
        addListener: vi.fn((listener: RuntimeListener) => {
          externalListeners.push(listener);
        })
      }
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionStorage, values);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStorage[key];
        })
      }
    },
    tabs: {
      query: vi.fn(async () => [activeTab]),
      sendMessage: vi.fn(async (tabId: number, message: unknown) => {
        sentTabMessages.push({ tabId, message });
      })
    }
  } as unknown as typeof chrome;
};

const loadBackground = async () => {
  vi.resetModules();
  installChromeMock();
  await import("./background");
};

const sendRuntimeMessage = (message: unknown, sender: chrome.runtime.MessageSender = {}) =>
  new Promise<unknown>((resolve) => {
    const shouldWait = runtimeListeners[0]!(message, sender, resolve);
    if (shouldWait !== true) {
      resolve(undefined);
    }
  });

const sendExternalMessage = (message: unknown) =>
  new Promise<unknown>((resolve) => {
    const shouldWait = externalListeners[0]!(message, {}, resolve);
    if (shouldWait !== true) {
      resolve(undefined);
    }
  });

beforeEach(async () => {
  await loadBackground();
});

describe("background session routing", () => {
  it("shows exact-origin credentials with matchType and fills only after popup confirmation", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(state).toEqual({
      origin: "https://example.com",
      credentials: [
        {
          id: "credential-1",
          title: "Example",
          origin: "https://example.com",
          username: "alice@example.com",
          matchType: "exact"
        }
      ]
    });

    const fill = await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "credential-1" });
    expect(fill).toEqual({ ok: true });
    expect(sentTabMessages).toEqual([
      {
        tabId: 42,
        message: {
          type: "FILL_CREDENTIAL",
          username: "alice@example.com",
          password: "correct horse battery staple"
        }
      }
    ]);
  });

  it("shows similar-origin credentials with warning", async () => {
    activeTab = { id: 42, url: "https://sub.example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials: [credential, similarCredential]
    });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://sub.example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const state = (await sendRuntimeMessage({ type: "GET_POPUP_STATE" })) as {
      credentials: Array<{ id: string; matchType: string }>;
    };
    // credential is similar (example.com vs sub.example.com), similarCredential is exact
    const exactMatch = state.credentials.find((c) => c.matchType === "exact");
    const similarMatch = state.credentials.find((c) => c.matchType === "similar");
    expect(exactMatch?.id).toBe("credential-similar");
    expect(similarMatch?.id).toBe("credential-1");
  });

  it("blocks suspicious origins from fill", async () => {
    activeTab = { id: 42, url: "https://example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials: [credential, suspiciousCredential]
    });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const fillSuspicious = await sendRuntimeMessage({
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-suspicious"
    });
    expect(fillSuspicious).toEqual({ ok: false, error: "suspicious_origin" });
    expect(sentTabMessages).toEqual([]);
  });

  it("blocks similar origin fill without acknowledgment", async () => {
    activeTab = { id: 42, url: "https://sub.example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials: [credential, similarCredential]
    });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://sub.example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    // Try to fill the similar credential without acknowledgment
    const fill = await sendRuntimeMessage({
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-1"
    });
    expect(fill).toEqual({ ok: false, error: "similar_origin_not_acknowledged" });
  });

  it("allows similar origin fill after acknowledgment", async () => {
    activeTab = { id: 42, url: "https://sub.example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials: [credential, similarCredential]
    });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://sub.example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    // Acknowledge the similar origin
    const ack = await sendRuntimeMessage({
      type: "ACKNOWLEDGE_SIMILAR_ORIGIN",
      credentialId: "credential-1"
    });
    expect(ack).toEqual({ ok: true });

    // Now fill should succeed
    const fill = await sendRuntimeMessage({
      type: "FILL_MATCHED_CREDENTIAL",
      credentialId: "credential-1"
    });
    expect(fill).toEqual({ ok: true });
  });

  it("clears extension candidates when Web Vault locks", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_CLEAR" });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(state).toEqual({
      origin: "https://example.com",
      credentials: [],
      blockedReason: "没有匹配的凭据"
    });
  });

  it("stores and clears test credentials via external messages", async () => {
    await sendExternalMessage({ type: "SET_TEST_CREDENTIALS", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(state).toEqual({
      origin: "https://example.com",
      credentials: [
        {
          id: "credential-1",
          title: "Example",
          origin: "https://example.com",
          username: "alice@example.com",
          matchType: "exact"
        }
      ]
    });

    await sendExternalMessage({ type: "CLEAR_TEST_CREDENTIALS" });
    const cleared = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(cleared).toEqual({
      origin: "https://example.com",
      credentials: [],
      blockedReason: "当前页面未检测到登录表单"
    });
  });

  it("ignores HTTP form candidates", async () => {
    activeTab = { id: 42, url: "http://example.com/login" } as chrome.tabs.Tab;
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "http://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(state).toEqual({
      origin: "http://example.com",
      credentials: [],
      blockedReason: "Zero Vault 仅支持 HTTPS 页面"
    });
  });

  it("does not show or fill stale candidates from another active tab", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );
    activeTab = { id: 99, url: "https://other.example/login" } as chrome.tabs.Tab;

    const state = await sendRuntimeMessage({ type: "GET_POPUP_STATE" });
    expect(state).toEqual({
      origin: "https://other.example",
      credentials: [],
      blockedReason: "当前页面未检测到登录表单"
    });

    const fill = await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "credential-1" });
    expect(fill).toEqual({ ok: false, error: "no_candidate" });
    expect(sentTabMessages).toEqual([]);
  });
});

describe("GET_EXTENSION_STATUS", () => {
  it("returns extension status via external message", async () => {
    await sendExternalMessage({ type: "SET_TEST_CREDENTIALS", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }]
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender
    );

    const status = await sendExternalMessage({ type: "GET_EXTENSION_STATUS" });
    expect(status).toEqual({
      installed: true,
      version: "0.1.0",
      credentialsLoaded: true,
      matchedCredentials: 1
    });
  });

  it("returns status with no matched credentials when on a blank tab", async () => {
    await sendExternalMessage({ type: "SET_TEST_CREDENTIALS", credentials: [credential] });
    activeTab = { id: 99, url: "https://other.com/blank" } as chrome.tabs.Tab;

    const status = await sendExternalMessage({ type: "GET_EXTENSION_STATUS" });
    expect(status).toEqual({
      installed: true,
      version: "0.1.0",
      credentialsLoaded: true,
      matchedCredentials: 0
    });
  });
});
