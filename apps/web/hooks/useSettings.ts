"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SETTINGS_STORAGE_KEYS = {
  AUTO_LOCK_TIMEOUT: "zero-vault.settings.auto-lock-timeout",
  AUTO_SYNC_ENABLED: "zero-vault.settings.auto-sync-enabled",
  SYNC_INTERVAL: "zero-vault.settings.sync-interval",
  EXTENSION_ID: "zero-vault.settings.extension-id"
} as const;

export const DEFAULT_AUTO_LOCK_TIMEOUT = 300;
const DEFAULT_AUTO_SYNC_ENABLED = true;
const DEFAULT_SYNC_INTERVAL = 900;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseSettings = ReturnType<typeof useSettings>;

export function useSettings() {
  const [autoLockTimeout, setAutoLockTimeout] = useState(DEFAULT_AUTO_LOCK_TIMEOUT);
  const [extensionId, setExtensionId] = useState("");
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(DEFAULT_AUTO_SYNC_ENABLED);
  const [syncInterval, setSyncInterval] = useState(DEFAULT_SYNC_INTERVAL);
  const loadedRef = useRef(false);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEYS.AUTO_LOCK_TIMEOUT);
    if (stored) {
      const val = Number(stored);
      setAutoLockTimeout(val);
    }
    const storedExtId = localStorage.getItem(SETTINGS_STORAGE_KEYS.EXTENSION_ID);
    if (storedExtId) setExtensionId(storedExtId);
    const storedAutoSync = localStorage.getItem(SETTINGS_STORAGE_KEYS.AUTO_SYNC_ENABLED);
    if (storedAutoSync !== null) setAutoSyncEnabled(storedAutoSync === "true");
    const storedInterval = localStorage.getItem(SETTINGS_STORAGE_KEYS.SYNC_INTERVAL);
    if (storedInterval) setSyncInterval(Number(storedInterval));
    loadedRef.current = true;
  }, []);

  // Persist on change
  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.AUTO_LOCK_TIMEOUT, String(autoLockTimeout));
  }, [autoLockTimeout]);

  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.AUTO_SYNC_ENABLED, String(autoSyncEnabled));
  }, [autoSyncEnabled]);

  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.SYNC_INTERVAL, String(syncInterval));
  }, [syncInterval]);

  useEffect(() => {
    if (!loadedRef.current) return;
    localStorage.setItem(SETTINGS_STORAGE_KEYS.EXTENSION_ID, extensionId);
  }, [extensionId]);

  const clearAllSettings = useCallback(() => {
    Object.values(SETTINGS_STORAGE_KEYS).forEach((key) => localStorage.removeItem(key));
  }, []);

  return {
    autoLockTimeout,
    setAutoLockTimeout,
    extensionId,
    setExtensionId,
    autoSyncEnabled,
    setAutoSyncEnabled,
    syncInterval,
    setSyncInterval,
    clearAllSettings,
    storageKeys: SETTINGS_STORAGE_KEYS
  };
}
