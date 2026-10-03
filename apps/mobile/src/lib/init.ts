/**
 * App initialization — wires up all dependencies at startup.
 * Must be called once before any React components render.
 */

import { configureApiClient, configureAuthDependencies } from "../state/auth-state";
import { configureVaultDependencies } from "../state/vault-state";
import { NativeMobileOpaqueAuthAdapter } from "./auth/native-mobile-auth-adapter";
import { installLocalizedAlerts } from "../i18n/alert";
import {
  NativeCryptoUnavailableAdapter,
  NativeMobileCryptoAdapter,
  type MobileCryptoAdapter,
} from "./crypto/mobile-crypto-adapter";
import { NativeRoomCiphertextStore } from "./storage/mobile-ciphertext-store";
import { ExpoSecureStoreAdapter } from "./storage/mobile-secure-store";

// Default API URL — override via environment or settings
const DEFAULT_API_URL = process.env.EXPO_PUBLIC_ZERO_VAULT_API_URL ?? "https://zero-vault.invalid";

function reportNativeInitializationFailure(caught: unknown): void {
  if (!__DEV__) return;
  const error = caught instanceof Error ? caught : null;
  const code = typeof caught === "object" && caught !== null && "code" in caught
    ? String((caught as { code: unknown }).code)
    : "UNKNOWN";
  // This runs before authentication and deliberately omits stack traces and
  // application state. It must never include passwords, keys or session data.
  console.error("[zero-vault] native security bridge initialization failed", {
    code,
    name: error?.name ?? typeof caught,
    message: error?.message ?? "Non-Error native initialization failure",
  });
}

export function initializeApp(options?: { apiUrl?: string }) {
  installLocalizedAlerts();
  const baseUrl = options?.apiUrl ?? DEFAULT_API_URL;

  const secureStore = new ExpoSecureStoreAdapter();
  configureApiClient({ baseUrl });

  let crypto: MobileCryptoAdapter = new NativeCryptoUnavailableAdapter();
  let opaqueAuth: NativeMobileOpaqueAuthAdapter | undefined;
  try {
    crypto = new NativeMobileCryptoAdapter();
    opaqueAuth = new NativeMobileOpaqueAuthAdapter();
  } catch (caught: unknown) {
    // Production fails closed; the auth state surfaces the unavailable gate.
    reportNativeInitializationFailure(caught);
  }
  configureAuthDependencies(opaqueAuth ? { secureStore, opaqueAuth } : { secureStore });

  configureVaultDependencies({
    crypto,
    ciphertextStoreFactory: (accountId) => new NativeRoomCiphertextStore(accountId),
    secureStore,
  });
}
