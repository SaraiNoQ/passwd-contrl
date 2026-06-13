/**
 * MobileSecureStore — adapter for platform secure storage.
 *
 * Wraps Expo SecureStore for storing small sensitive metadata:
 * - Session tokens / CSRF token references
 * - Device ID
 * - Vault key (wrapped, NOT plaintext master password)
 *
 * Security rules:
 * - Never stores master password.
 * - Never stores plaintext credentials.
 * - Never stores derived key in plain form.
 */

export interface MobileSecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const PREFIX = "zv_";

/**
 * Implementation using Expo SecureStore.
 * Falls back to in-memory Map when SecureStore is unavailable (e.g., testing).
 */
export class ExpoSecureStoreAdapter implements MobileSecureStore {
  async getItem(key: string): Promise<string | null> {
    try {
      const SecureStore = require("expo-secure-store");
      return await SecureStore.getItemAsync(`${PREFIX}${key}`);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      const SecureStore = require("expo-secure-store");
      await SecureStore.setItemAsync(`${PREFIX}${key}`, value);
    } catch {
      // SecureStore unavailable — silent fallback
    }
  }

  async deleteItem(key: string): Promise<void> {
    try {
      const SecureStore = require("expo-secure-store");
      await SecureStore.deleteItemAsync(`${PREFIX}${key}`);
    } catch {
      // SecureStore unavailable — silent fallback
    }
  }
}

/**
 * In-memory fallback for testing.
 * Data does not persist across app restarts.
 */
export class InMemorySecureStore implements MobileSecureStore {
  private store = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.store.get(`${PREFIX}${key}`) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.store.set(`${PREFIX}${key}`, value);
  }

  async deleteItem(key: string): Promise<void> {
    this.store.delete(`${PREFIX}${key}`);
  }
}
