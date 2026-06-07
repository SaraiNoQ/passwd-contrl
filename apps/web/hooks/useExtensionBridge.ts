"use client";

import { useCallback, useState } from "react";
import {
  getExtensionBridgeCapabilities,
  publishVaultSessionToExtension,
  clearVaultSessionFromExtension,
  type ExtensionBridgeResult
} from "../lib/extension-bridge";
import type { VaultItem } from "../lib/local-vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExtensionBridgeUiState = {
  configured: boolean;
  runtimeAvailable: boolean;
  communication: string;
  lastPublish: string;
  lastClear: string;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useExtensionBridge() {
  const [state, setState] = useState<ExtensionBridgeUiState>(() => {
    const capabilities = getExtensionBridgeCapabilities();
    return {
      configured: capabilities.configured,
      runtimeAvailable: capabilities.runtimeAvailable,
      communication: capabilities.runtimeAvailable ? "已就绪" : "未连接",
      lastPublish: "尚未发布",
      lastClear: "尚未清除"
    };
  });

  const refreshCapabilities = useCallback(() => {
    const capabilities = getExtensionBridgeCapabilities();
    setState((prev) => ({
      ...prev,
      configured: capabilities.configured,
      runtimeAvailable: capabilities.runtimeAvailable,
      communication: capabilities.runtimeAvailable ? prev.communication : "未连接"
    }));
  }, []);

  const recordResult = useCallback((result: ExtensionBridgeResult) => {
    const outcome = `${result.ok ? "OK" : "Issue"} · ${result.message}`;
    setState((prev) => ({
      ...prev,
      configured: result.configured,
      runtimeAvailable: result.runtimeAvailable,
      communication: result.ok ? "已连接" : "未连接",
      lastPublish: result.action === "publish" ? outcome : prev.lastPublish,
      lastClear: result.action === "clear" ? outcome : prev.lastClear
    }));
  }, []);

  const publishSession = useCallback(
    (items: VaultItem[]) => {
      refreshCapabilities();
      void publishVaultSessionToExtension(items).then(recordResult);
    },
    [refreshCapabilities, recordResult]
  );

  const clearSession = useCallback(() => {
    refreshCapabilities();
    void clearVaultSessionFromExtension().then(recordResult);
  }, [refreshCapabilities, recordResult]);

  return {
    state,
    refreshCapabilities,
    publishSession,
    clearSession
  };
}
