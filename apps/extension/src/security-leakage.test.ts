import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Security regression tests for the browser extension.
 *
 * These tests verify:
 * - Popup state never exposes passwords
 * - No silent autofill (requires explicit user action)
 * - No auto-submit after fill
 * - Fills are blocked on HTTP, hidden, invisible, disabled, readonly, and cross-origin iframe fields
 */

type RuntimeListener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: unknown) => void) => boolean | void;

const SECRETS = {
  password: "correct horse battery staple",
  username: "alice@example.com",
  origin: "https://example.com",
};

const credential = {
  id: "cred-1",
  title: "Example",
  origin: SECRETS.origin,
  username: SECRETS.username,
  password: SECRETS.password,
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
        }),
      },
      onMessageExternal: {
        addListener: vi.fn((listener: RuntimeListener) => {
          externalListeners.push(listener);
        }),
      },
    },
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionStorage[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          Object.assign(sessionStorage, values);
        }),
        remove: vi.fn(async (key: string) => {
          delete sessionStorage[key];
        }),
      },
    },
    tabs: {
      query: vi.fn(async () => [activeTab]),
      sendMessage: vi.fn(async (tabId: number, message: unknown) => {
        sentTabMessages.push({ tabId, message });
      }),
    },
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

describe("security: popup state never exposes passwords", () => {
  it("GET_POPUP_STATE returns credentials without password field", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: SECRETS.origin,
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const state = (await sendRuntimeMessage({ type: "GET_POPUP_STATE" })) as {
      credentials: Array<Record<string, unknown>>;
    };

    expect(state.credentials).toHaveLength(1);
    const displayed = state.credentials[0]!;
    // Password must NOT be in the popup state
    expect(displayed.password).toBeUndefined();
    expect(JSON.stringify(displayed)).not.toContain(SECRETS.password);
    // Other fields should be present
    expect(displayed.id).toBe("cred-1");
    expect(displayed.username).toBe(SECRETS.username);
    expect(displayed.origin).toBe(SECRETS.origin);
    expect(displayed.matchType).toBe("exact");
  });

  it("similar-origin credentials shown without password", async () => {
    activeTab = { id: 42, url: "https://sub.example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({
      type: "ZERO_VAULT_SESSION_UPDATE",
      credentials: [
        credential,
        { id: "cred-2", title: "Sub", origin: "https://sub.example.com", username: "bob", password: "other-pass" },
      ],
    });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://sub.example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const state = (await sendRuntimeMessage({ type: "GET_POPUP_STATE" })) as {
      credentials: Array<Record<string, unknown>>;
    };

    for (const cred of state.credentials) {
      expect(cred.password).toBeUndefined();
      expect(JSON.stringify(cred)).not.toContain(SECRETS.password);
      expect(JSON.stringify(cred)).not.toContain("other-pass");
    }
  });
});

describe("security: no silent autofill", () => {
  it("FILL_MATCHED_CREDENTIAL requires explicit credentialId and does not auto-trigger", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: SECRETS.origin,
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    // No fill should have happened yet
    expect(sentTabMessages).toEqual([]);

    // Only explicit fill request triggers the fill
    const fill = await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-1" });
    expect(fill).toEqual({ ok: true });
    expect(sentTabMessages).toHaveLength(1);
    expect(sentTabMessages[0]!.message).toMatchObject({
      type: "FILL_CREDENTIAL",
      username: SECRETS.username,
      password: SECRETS.password,
    });
  });
});

describe("security: no auto-submit after fill", () => {
  it("FILL_CREDENTIAL message does not contain submit flag", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: SECRETS.origin,
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-1" });

    expect(sentTabMessages).toHaveLength(1);
    const message = sentTabMessages[0]!.message as Record<string, unknown>;
    // No submit, no autoSubmit, no trigger field
    expect(message).not.toHaveProperty("submit");
    expect(message).not.toHaveProperty("autoSubmit");
    expect(message).not.toHaveProperty("trigger");
    // Only type, username, password
    expect(Object.keys(message).sort()).toEqual(["password", "type", "username"]);
  });
});

describe("security: blocks fills on insecure contexts", () => {
  it("blocks fills on HTTP pages", async () => {
    activeTab = { id: 42, url: "http://example.com/login" } as chrome.tabs.Tab;
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "http://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const state = (await sendRuntimeMessage({ type: "GET_POPUP_STATE" })) as {
      blockedReason: string;
      credentials: unknown[];
    };
    expect(state.blockedReason).toContain("HTTPS");
    expect(state.credentials).toEqual([]);
  });

  it("ignores HTTP form candidates", async () => {
    activeTab = { id: 42, url: "http://insecure.com" } as chrome.tabs.Tab;
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "http://insecure.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const state = (await sendRuntimeMessage({ type: "GET_POPUP_STATE" })) as {
      credentials: unknown[];
    };
    expect(state.credentials).toEqual([]);
  });
});

describe("security: blocks cross-origin credential fill", () => {
  it("blocks fill when credential origin does not match active tab", async () => {
    activeTab = { id: 42, url: "https://evil.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://evil.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const fill = await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-1" });
    expect(fill).toEqual({ ok: false, error: "origin_mismatch" });
    expect(sentTabMessages).toEqual([]);
  });

  it("blocks suspicious (punycode) origin fill", async () => {
    const phishCredential = {
      id: "cred-phish",
      title: "Google",
      origin: "https://xn--googl-e4d.com",
      username: "victim@google.com",
      password: "stolen-pass",
    };
    activeTab = { id: 42, url: "https://example.com/login" } as chrome.tabs.Tab;
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential, phishCredential] });
    await sendRuntimeMessage(
      {
        type: "FORM_CANDIDATES",
        origin: "https://example.com",
        forms: [{ usernameFieldId: "username", passwordFieldId: "password" }],
      },
      { tab: { id: 42 } } as chrome.runtime.MessageSender,
    );

    const fill = await sendRuntimeMessage({ type: "FILL_MATCHED_CREDENTIAL", credentialId: "cred-phish" });
    expect(fill).toEqual({ ok: false, error: "suspicious_origin" });
    expect(sentTabMessages).toEqual([]);
  });
});

describe("security: form detection filters unsafe fields", () => {
  const visibleRect = {
    x: 0, y: 0, width: 160, height: 36,
    top: 0, right: 160, bottom: 36, left: 0,
    toJSON: () => ({}),
  };

  it("rejects disabled password fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    document.body.innerHTML = `<input type="password" disabled />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects readonly password fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    document.body.innerHTML = `<input type="password" readonly />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects hidden type fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    document.body.innerHTML = `<input type="hidden" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects zero-dimension fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 0, height: 0,
      top: 0, right: 0, bottom: 0, left: 0,
      toJSON: () => ({}),
    });
    document.body.innerHTML = `<input type="password" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects display:none fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    document.body.innerHTML = `<input type="password" style="display:none" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });

  it("rejects visibility:hidden fields", async () => {
    const { isSafeToFill } = await import("./form-fill");
    document.body.innerHTML = `<input type="password" style="visibility:hidden" />`;
    const input = document.querySelector<HTMLInputElement>("input")!;
    expect(isSafeToFill(input)).toBe(false);
  });
});

describe("security: session credentials storage", () => {
  it("session credentials are stored in session storage, not localStorage", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });

    // Verify chrome.storage.session was used (not localStorage)
    expect(chrome.storage.session.set).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionCredentials: expect.arrayContaining([
          expect.objectContaining({ id: "cred-1" }),
        ]),
      }),
    );
  });

  it("session clear removes all credential data", async () => {
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_UPDATE", credentials: [credential] });
    await sendExternalMessage({ type: "ZERO_VAULT_SESSION_CLEAR" });

    expect(chrome.storage.session.remove).toHaveBeenCalledWith("sessionCredentials");
    expect(chrome.storage.session.remove).toHaveBeenCalledWith("lastCandidate");
    expect(chrome.storage.session.remove).toHaveBeenCalledWith("acknowledgedOrigins");
  });
});
