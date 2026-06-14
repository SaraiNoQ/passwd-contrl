/**
 * Desktop app initialization — wires up all dependencies at startup.
 * Must be called once before any React components render.
 */

import { configureApiClient } from "../state/auth-state";
import { configureVaultDependencies } from "../state/vault-state";
import { DesktopApiClient } from "./api/desktop-api-client";
import { TauriCryptoAdapter } from "./crypto/desktop-crypto-adapter";
import { SqliteCiphertextStore } from "./storage/desktop-ciphertext-store";
import { KeychainAdapter } from "./storage/desktop-secure-store";

const DEFAULT_API_URL = "http://localhost:8787";

export function initializeApp(options?: { apiUrl?: string }) {
  const baseUrl = options?.apiUrl ?? DEFAULT_API_URL;

  const client = new DesktopApiClient({ baseUrl });
  const cryptoAdapter = new TauriCryptoAdapter();
  const ciphertextStore = new SqliteCiphertextStore();
  const secureStore = new KeychainAdapter();

  configureApiClient(client);
  configureVaultDependencies({
    apiClient: client,
    cryptoAdapter,
    ciphertextStore,
    secureStore,
  });
}
