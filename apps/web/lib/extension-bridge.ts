import type { VaultItem } from "./local-vault";
import { isLogin } from "./item-types";

declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (extensionId: string, message: unknown, callback?: (response: unknown) => void) => void;
        lastError?: { message?: string };
      };
    };
  }
}

const extensionId = process.env.NEXT_PUBLIC_EXTENSION_ID;

export type ExtensionBridgeAction = "publish" | "clear";

export type ExtensionBridgeCapabilities = {
  configured: boolean;
  runtimeAvailable: boolean;
  extensionId?: string;
};

export type ExtensionBridgeResult = ExtensionBridgeCapabilities & {
  action: ExtensionBridgeAction;
  ok: boolean;
  message: string;
  completedAt: string;
};

const getRuntime = () => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.chrome?.runtime;
};

export const getExtensionBridgeCapabilities = (): ExtensionBridgeCapabilities => {
  const capabilities = {
    configured: Boolean(extensionId),
    runtimeAvailable: Boolean(getRuntime()?.sendMessage)
  };

  return extensionId ? { ...capabilities, extensionId } : capabilities;
};

const result = (
  action: ExtensionBridgeAction,
  ok: boolean,
  message: string,
  capabilities = getExtensionBridgeCapabilities()
): ExtensionBridgeResult => ({
  ...capabilities,
  action,
  ok,
  message,
  completedAt: new Date().toISOString()
});

const sendExtensionMessage = (action: ExtensionBridgeAction, message: unknown): Promise<ExtensionBridgeResult> => {
  const capabilities = getExtensionBridgeCapabilities();
  if (!capabilities.configured) {
    return Promise.resolve(result(action, false, "NEXT_PUBLIC_EXTENSION_ID is not configured.", capabilities));
  }
  const runtime = getRuntime();
  const sendMessage = runtime?.sendMessage;
  if (!sendMessage || !extensionId) {
    return Promise.resolve(result(action, false, "Chrome extension messaging is unavailable in this browser.", capabilities));
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (bridgeResult: ExtensionBridgeResult) => {
      if (!settled) {
        settled = true;
        resolve(bridgeResult);
      }
    };

    const timeout = globalThis.setTimeout(() => {
      finish(result(action, false, "Extension did not respond to the Web Vault message.", capabilities));
    }, 1500);

    sendMessage(extensionId, message, () => {
      globalThis.clearTimeout(timeout);
      const lastError = runtime.lastError?.message;
      finish(result(action, !lastError, lastError || "Extension bridge communication succeeded.", capabilities));
    });
  });
};

export const publishVaultSessionToExtension = (items: VaultItem[]) => {
  const loginItems = items.filter(isLogin);
  return sendExtensionMessage("publish", {
    type: "ZERO_VAULT_SESSION_UPDATE",
    credentials: loginItems.map((item) => ({
      type: "login" as const,
      id: item.id,
      title: item.title,
      origin: item.origin,
      username: item.username,
      password: item.password,
      ...(item.totp ? { totp: item.totp } : {})
    }))
  });
};

export const clearVaultSessionFromExtension = () => {
  return sendExtensionMessage("clear", { type: "ZERO_VAULT_SESSION_CLEAR" });
};
