/**
 * App initialization — wires up all dependencies at startup.
 * Must be called once before any React components render.
 */

import { configureApiClient } from "../state/auth-state";
import { configureVaultDependencies } from "../state/vault-state";
import { TestDoubleCryptoAdapter } from "./crypto/mobile-crypto-adapter";
import { InMemoryCiphertextStore } from "./storage/mobile-ciphertext-store";
import { InMemorySecureStore } from "./storage/mobile-secure-store";

// Default API URL — override via environment or settings
const DEFAULT_API_URL = "http://localhost:8787";

export function initializeApp(options?: { apiUrl?: string }) {
  const baseUrl = options?.apiUrl ?? DEFAULT_API_URL;

  // Configure API client
  configureApiClient({ baseUrl });

  // Configure vault dependencies
  // MVP: uses test doubles and in-memory stores.
  // Production: replace with real crypto adapter (UniFFI) and persistent stores.
  configureVaultDependencies({
    crypto: new TestDoubleCryptoAdapter(),
    ciphertextStore: new InMemoryCiphertextStore(),
    secureStore: new InMemorySecureStore(),
  });
}
