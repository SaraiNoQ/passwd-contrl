/**
 * MobileSecureStore — adapter for platform secure storage.
 *
 * Wraps Expo SecureStore for storing small sensitive metadata:
 * - The encrypted-at-rest mobile session bundle used for online and offline startup
 * - Security preferences such as the persisted automatic-lock interval
 *
 * Security rules:
 * - Never stores master password.
 * - Never stores plaintext credentials.
 * - Never stores vault keys, device private keys, OPAQUE state, or derived keys;
 *   those remain in the Kotlin/Rust/Keystore boundary.
 */

export interface MobileSecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const PREFIX = "zv_";

/**
 * Production implementation using Expo SecureStore. Errors are intentionally
 * propagated: security-sensitive storage must never fall back silently.
 */
export class ExpoSecureStoreAdapter implements MobileSecureStore {
  async getItem(key: string): Promise<string | null> {
    const SecureStore = await import("expo-secure-store");
    return SecureStore.getItemAsync(`${PREFIX}${key}`);
  }

  async setItem(key: string, value: string): Promise<void> {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(`${PREFIX}${key}`, value);
  }

  async deleteItem(key: string): Promise<void> {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(`${PREFIX}${key}`);
  }
}

/**
 * In-memory implementation for tests only.
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
