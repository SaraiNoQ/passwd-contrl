import { afterEach, describe, expect, it, vi } from "vitest";

const credential = {
  type: "login" as const,
  id: "credential-1",
  title: "Example",
  origin: "https://example.com",
  username: "alice@example.com",
  password: "correct horse battery staple",
  notes: "local note",
  folder: "",
  customFields: [],
  createdAt: "2026-06-04T00:00:00.000Z",
  updatedAt: "2026-06-04T00:00:00.000Z"
};

const loadBridge = async (sendMessage = vi.fn((_: string, __: unknown, callback?: () => void) => callback?.())) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "extension-id");
  vi.stubGlobal("window", {
    chrome: {
      runtime: {
        sendMessage
      }
    }
  });
  return {
    sendMessage,
    bridge: await import("./extension-bridge")
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("extension bridge", () => {
  it("publishes unlocked credentials as a short-lived extension session", async () => {
    const { bridge, sendMessage } = await loadBridge();

    const result = await bridge.publishVaultSessionToExtension([credential]);

    expect(sendMessage).toHaveBeenCalledWith(
      "extension-id",
      {
        type: "ZERO_VAULT_SESSION_UPDATE",
        credentials: [
          {
            type: "login",
            id: "credential-1",
            title: "Example",
            origin: "https://example.com",
            username: "alice@example.com",
            password: "correct horse battery staple"
          }
        ]
      },
      expect.any(Function)
    );
    expect(result).toMatchObject({
      action: "publish",
      configured: true,
      runtimeAvailable: true,
      ok: true,
      message: "Extension bridge communication succeeded."
    });
  });

  it("clears the extension session when Web Vault locks", async () => {
    const { bridge, sendMessage } = await loadBridge();

    const result = await bridge.clearVaultSessionFromExtension();

    expect(sendMessage).toHaveBeenCalledWith(
      "extension-id",
      { type: "ZERO_VAULT_SESSION_CLEAR" },
      expect.any(Function)
    );
    expect(result).toMatchObject({
      action: "clear",
      ok: true,
      message: "Extension bridge communication succeeded."
    });
  });

  it("does nothing when no extension id is configured", async () => {
    const sendMessage = vi.fn();
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "");
    vi.stubGlobal("window", {
      chrome: {
        runtime: {
          sendMessage
        }
      }
    });
    const bridge = await import("./extension-bridge");

    const publish = await bridge.publishVaultSessionToExtension([credential]);
    const clear = await bridge.clearVaultSessionFromExtension();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(publish).toMatchObject({
      action: "publish",
      configured: false,
      runtimeAvailable: true,
      ok: false,
      message: "NEXT_PUBLIC_EXTENSION_ID is not configured."
    });
    expect(clear).toMatchObject({
      action: "clear",
      configured: false,
      runtimeAvailable: true,
      ok: false
    });
  });

  it("reports extension runtime failures for bridge status UI", async () => {
    const sendMessage = vi.fn((_: string, __: unknown, callback?: () => void) => callback?.());
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_EXTENSION_ID", "extension-id");
    vi.stubGlobal("window", {
      chrome: {
        runtime: {
          sendMessage,
          lastError: { message: "Could not establish connection." }
        }
      }
    });
    const bridge = await import("./extension-bridge");

    const result = await bridge.publishVaultSessionToExtension([credential]);

    expect(result).toMatchObject({
      action: "publish",
      configured: true,
      runtimeAvailable: true,
      ok: false,
      message: "Could not establish connection."
    });
  });
});
