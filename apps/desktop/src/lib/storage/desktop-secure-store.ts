/**
 * DesktopSecureStore — adapter for platform secure storage.
 *
 * Wraps macOS Keychain via Tauri IPC for storing small sensitive metadata:
 * - Session tokens / CSRF token references
 * - Device ID
 * - Vault key (wrapped, NOT plaintext master password)
 *
 * Security rules:
 * - Never stores master password.
 * - Never stores plaintext credentials.
 * - Never stores derived key in plain form.
 */

import { invoke } from "@tauri-apps/api/core";

export interface DesktopSecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

const PREFIX = "zv_";

/**
 * Production implementation using macOS Keychain via Tauri IPC.
 * The Rust backend uses the `keyring` crate with service "com.zerovault.desktop".
 */
export class KeychainAdapter implements DesktopSecureStore {
  async getItem(key: string): Promise<string | null> {
    try {
      return await invoke<string | null>("keychain_get_item", {
        key: `${PREFIX}${key}`,
      });
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await invoke<void>("keychain_set_item", {
      key: `${PREFIX}${key}`,
      value,
    });
  }

  async deleteItem(key: string): Promise<void> {
    await invoke<void>("keychain_delete_item", {
      key: `${PREFIX}${key}`,
    });
  }
}

/**
 * In-memory fallback for testing.
 * Data does not persist across app restarts.
 */
export class InMemorySecureStore implements DesktopSecureStore {
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
