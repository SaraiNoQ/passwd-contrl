import type { MatchedCredentialDisplay, PopupStateResponse } from "./messages";
import { generateTotpCode } from "./totp";

const root = document.getElementById("root");
const scan = document.getElementById("scan");
const versionEl = document.getElementById("version");
const connectionStatusEl = document.getElementById("connection-status");
const originDisplayEl = document.getElementById("origin-display");
const footerEl = document.getElementById("footer");
const openVaultLink = document.getElementById("open-vault") as HTMLAnchorElement | null;

let selectedIndex = 0;
let credentialElements: HTMLButtonElement[] = [];
let currentCredentials: MatchedCredentialDisplay[] = [];
let vaultCredentialsLoaded = false;
let vaultStatusChecked = false;

const EXTENSION_VERSION = "0.1.0";

// Map internal fill-error codes to Chinese messages
const errorMessageMap: Record<string, string> = {
  no_candidate: "未检测到表单",
  origin_mismatch: "域名不匹配",
  suspicious_origin: "检测到可疑域名，已阻止填充",
  similar_origin_not_acknowledged: "请先确认此站点后再填充",
};

// Show extension version in header badge
if (versionEl) {
  versionEl.textContent = `v${EXTENSION_VERSION}`;
}

// Footer
if (footerEl) {
  footerEl.textContent = `Zero Vault · 零知识密码管理器 v${EXTENSION_VERSION}`;
}

// Open vault link
if (openVaultLink) {
  openVaultLink.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL("bridge.html") });
  });
}

// Check connection / vault status, then refresh popup state
chrome.runtime.sendMessage({ type: "GET_EXTENSION_STATUS" }, (response) => {
  if (chrome.runtime.lastError || !response?.installed) {
    if (connectionStatusEl) {
      connectionStatusEl.innerHTML = '<span class="dot disconnected"></span> 未连接到 Web Vault';
    }
  } else {
    vaultCredentialsLoaded = response.credentialsLoaded;
    vaultStatusChecked = true;

    if (connectionStatusEl) {
      if (vaultCredentialsLoaded) {
        const credsText = `${response.matchedCredentials} 个凭据`;
        connectionStatusEl.innerHTML = `<span class="dot connected"></span> 已解锁 · ${credsText}`;
      } else {
        connectionStatusEl.innerHTML = '<span class="dot disconnected"></span> 已锁定';
      }
    }
  }

  // Once we know vault status, fetch popup state
  refresh();
});

const renderSimilarOriginWarning = (credential: MatchedCredentialDisplay): string => `
  <div class="credential" data-credential-id="${credential.id}" data-match-type="similar" tabindex="0" role="button" aria-label="填充凭据 ${credential.title}">
    <span class="cred-title">${credential.title} <span class="badge similar">相似域名</span></span>
    <span class="cred-username">${credential.username || "无用户名"}</span>
  </div>
  <div class="status-section similar-warning">
    <span class="status-icon">⚠</span>
    <span>检测到相似域名，请手动确认</span>
  </div>
  <button class="acknowledge-btn" data-ack-credential-id="${credential.id}" type="button">
    确认填充
  </button>
`;

const renderSuspiciousCredential = (credential: MatchedCredentialDisplay): string => `
  <div class="credential-blocked">
    <span class="blocked-title">${credential.title} <span class="badge suspicious">可疑域名</span></span>
    <span class="blocked-reason">潜在钓鱼站点，已阻止填充</span>
  </div>
`;

const render = (state: PopupStateResponse) => {
  if (!root) {
    return;
  }

  currentCredentials = state.credentials;
  selectedIndex = 0;

  // Show origin
  if (originDisplayEl && state.origin) {
    originDisplayEl.textContent = state.origin;
  } else if (originDisplayEl) {
    originDisplayEl.textContent = "";
  }

  // Priority 0: Vault locked
  if (vaultStatusChecked && !vaultCredentialsLoaded) {
    root.innerHTML = `
      <div class="status-section vault-locked">
        <span class="status-icon">🔒</span>
        <span>密码库已锁定，请在 Web Vault 中解锁</span>
      </div>
    `;
    credentialElements = [];
    return;
  }

  // Separate credentials by match type
  const exactCreds = state.credentials.filter((c) => c.matchType === "exact");
  const similarCreds = state.credentials.filter((c) => c.matchType === "similar");
  const suspiciousCreds = state.credentials.filter((c) => c.matchType === "suspicious");

  // Priority 1: Non-HTTPS page — origin is set but doesn't start with https://
  if (state.blockedReason && state.credentials.length === 0) {
    if (state.origin && !state.origin.startsWith("https://")) {
      root.innerHTML = `
        <div class="status-section http-blocked">
          <span class="status-icon">🔒</span>
          <span>Zero Vault 仅支持 HTTPS 页面</span>
        </div>
      `;
      credentialElements = [];
      return;
    }
  }

  // Priority 2: No form detected — use blockedReason text directly
  if (state.blockedReason && state.blockedReason === "当前页面未检测到登录表单" && state.credentials.length === 0) {
    root.innerHTML = `
      <div class="status-section no-form">
        <span class="status-icon">○</span>
        <span>当前页面未检测到登录表单</span>
      </div>
    `;
    credentialElements = [];
    return;
  }

  // Priority 3: No matching credentials
  if (state.blockedReason && state.credentials.length === 0) {
    root.innerHTML = `
      <div class="status-section no-matches">
        <span class="status-icon">○</span>
        <span>没有匹配的凭据</span>
      </div>
    `;
    credentialElements = [];
    return;
  }

  // Fallback: No credentials and no blocked reason
  if (state.credentials.length === 0) {
    root.innerHTML = `
      <div class="state-empty">
        <p>没有匹配的凭据</p>
      </div>
    `;
    credentialElements = [];
    return;
  }

  let html = "";

  // Section header
  html += `<div class="section-header">匹配凭据</div>`;

  // Exact match credential list
  const exactButtons = exactCreds
    .map(
      (credential) => `
        <div class="credential" data-credential-id="${credential.id}" data-match-type="exact" data-totp="${credential.totp ?? ""}" tabindex="0" role="button" aria-label="填充凭据 ${credential.title}">
          <span class="cred-title">${credential.title} <span class="badge exact">精确匹配</span></span>
          <span class="cred-username">${credential.username || "无用户名"}</span>
          ${credential.totp ? `<span class="totp-code" data-totp-secret="${credential.totp}" aria-label="验证码">------</span>` : ""}
          <button class="fill-btn" data-fill-credential-id="${credential.id}" type="button" aria-label="填充此凭据">填充</button>
        </div>
      `
    )
    .join("");

  if (exactButtons) {
    html += `<div class="credentials">${exactButtons}</div>`;
  }

  // Similar origin credentials with acknowledge buttons
  for (const credential of similarCreds) {
    html += `<div class="credentials">${renderSimilarOriginWarning(credential)}</div>`;
  }

  // Suspicious (blocked) credentials
  for (const credential of suspiciousCreds) {
    html += `<div class="credentials">${renderSuspiciousCredential(credential)}</div>`;
  }

  // Filling indicator placeholder
  html += '<div class="filling-indicator" id="filling-indicator"></div>';

  root.innerHTML = html;

  // Gather focusable credential buttons for keyboard nav
  credentialElements = Array.from(root.querySelectorAll<HTMLButtonElement>(".credential[data-credential-id]"));

  // Add click handlers for exact credentials (click on credential row)
  for (const button of credentialElements) {
    const matchType = button.dataset.matchType;
    if (matchType === "exact") {
      button.addEventListener("click", (e) => {
        // Don't fill if the click was on the fill button itself (it has its own handler)
        if ((e.target as HTMLElement).closest(".fill-btn")) return;
        fillCredential(button.dataset.credentialId!, button);
      });
    }
  }

  // Add click handlers for explicit fill buttons
  for (const fillBtn of Array.from(root.querySelectorAll<HTMLButtonElement>(".fill-btn"))) {
    fillBtn.addEventListener("click", () => {
      const credId = fillBtn.dataset.fillCredentialId;
      if (!credId) return;
      const credButton = root.querySelector<HTMLButtonElement>(`.credential[data-credential-id="${credId}"]`);
      fillCredential(credId, credButton || fillBtn);
    });
  }

  // Initialize TOTP code display and refresh
  const totpElements = root.querySelectorAll<HTMLElement>(".totp-code[data-totp-secret]");
  if (totpElements.length > 0) {
    const updateTotpCodes = async () => {
      for (const el of totpElements) {
        const secret = el.dataset.totpSecret;
        if (!secret) continue;
        try {
          const { code, remaining } = await generateTotpCode(secret);
          el.textContent = `${code.slice(0, 3)} ${code.slice(3)}`;
          el.title = `${remaining}秒后刷新`;
          if (remaining <= 5) el.style.color = "var(--color-error, #ef4444)";
          else el.style.color = "";
        } catch {
          el.textContent = "错误";
        }
      }
    };
    void updateTotpCodes();
    setInterval(() => void updateTotpCodes(), 1000);

    // Click to copy TOTP code
    for (const el of totpElements) {
      el.addEventListener("click", async (e) => {
        e.stopPropagation();
        const text = el.textContent?.replace(/\s/gu, "") ?? "";
        if (text && text !== "------" && text !== "错误") {
          await navigator.clipboard.writeText(text);
          el.textContent = "已复制!";
          setTimeout(() => void updateTotpCodes(), 1000);
        }
      });
      el.style.cursor = "pointer";
    }
  }

  // Add click handlers for acknowledged similar credentials
  for (const ackBtn of Array.from(root.querySelectorAll<HTMLButtonElement>(".acknowledge-btn"))) {
    ackBtn.addEventListener("click", () => {
      const credId = ackBtn.dataset.ackCredentialId;
      if (!credId) return;
      chrome.runtime.sendMessage({ type: "ACKNOWLEDGE_SIMILAR_ORIGIN", credentialId: credId }, (response) => {
        if (response?.ok) {
          // After acknowledgment, allow filling
          const credButton = root.querySelector<HTMLButtonElement>(`.credential[data-credential-id="${credId}"]`);
          if (credButton) {
            credButton.dataset.matchType = "acknowledged";
            credButton.addEventListener("click", () => fillCredential(credId, credButton));
            // Remove warning section and acknowledge button
            const warningSection = ackBtn.previousElementSibling;
            if (warningSection?.classList.contains("similar-warning")) warningSection.remove();
            ackBtn.remove();
            const badge = credButton.querySelector(".badge.similar");
            if (badge) {
              badge.textContent = "已确认";
              badge.classList.remove("similar");
              badge.classList.add("exact");
            }
          }
        }
      });
    });
  }

  // Update selection highlight
  updateSelection();
};

const updateSelection = () => {
  credentialElements.forEach((el, i) => {
    el.classList.toggle("selected", i === selectedIndex);
  });
};

const fillCredential = (credentialId: string | undefined, button: HTMLElement) => {
  if (!credentialId) return;
  const indicator = document.getElementById("filling-indicator");
  if (indicator) indicator.textContent = "填充中…";

  // Disable fill button if it exists
  const fillBtn = root?.querySelector<HTMLButtonElement>(`[data-fill-credential-id="${credentialId}"]`);
  if (fillBtn) fillBtn.disabled = true;

  chrome.runtime.sendMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId }, (response) => {
    if (indicator) {
      if (response?.ok) {
        indicator.textContent = "填充成功";
        indicator.style.color = "#34d399";
      } else {
        const errMsg = errorMessageMap[response?.error] || response?.error || "未知错误";
        indicator.textContent = `填充失败: ${errMsg}`;
        indicator.style.color = "#f87171";
        if (fillBtn) fillBtn.disabled = false;
      }
    }
  });
};

const refresh = () => {
  chrome.runtime.sendMessage({ type: "GET_POPUP_STATE" }, (state: PopupStateResponse) => {
    render(state);
  });
};

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (credentialElements.length === 0) return;

  if (e.key === "ArrowDown" || e.key === "ArrowRight") {
    e.preventDefault();
    selectedIndex = (selectedIndex + 1) % credentialElements.length;
    updateSelection();
    credentialElements[selectedIndex]?.focus();
  } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
    e.preventDefault();
    selectedIndex = (selectedIndex - 1 + credentialElements.length) % credentialElements.length;
    updateSelection();
    credentialElements[selectedIndex]?.focus();
  } else if (e.key === "Enter") {
    e.preventDefault();
    const selected = credentialElements[selectedIndex];
    if (selected) {
      const matchType = selected.dataset.matchType;
      if (matchType === "exact" || matchType === "acknowledged") {
        fillCredential(selected.dataset.credentialId!, selected);
      }
    }
  }
});

scan?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    files: ["dist/content-script.js"],
  });
  window.setTimeout(refresh, 120);
});

// Initial refresh — the GET_EXTENSION_STATUS callback also calls refresh() once
// vault status is known; this module-scope call ensures the popup renders even
// before the status check completes.
refresh();
