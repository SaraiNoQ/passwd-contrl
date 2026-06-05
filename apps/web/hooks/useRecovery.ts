"use client";

import { useCallback, useState } from "react";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  recoverVaultKey,
  saveRecoveryPacket,
  loadRecoveryPacket,
  type RecoveryPacket
} from "../lib/recovery";
import { fetchRecoveryPacket, saveRecoveryPacketToServer } from "../lib/api-client";
import { toBase64Url, fromBase64Url, encodeText } from "../lib/crypto-utils";

// Re-export for convenience
export type { RecoveryPacket } from "../lib/recovery";

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export type UseRecovery = ReturnType<typeof useRecovery>;

export function useRecovery() {
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryConfirmed, setRecoveryConfirmed] = useState(false);
  const [showRecoveryEntry, setShowRecoveryEntry] = useState(false);
  const [recoveryInputCode, setRecoveryInputCode] = useState("");
  const [recoveryPassword, setRecoveryPassword] = useState("");

  /** Show a recovery code in the modal (used after registration or manual generation). */
  const showRecoveryCode = useCallback((code: string) => {
    setRecoveryCode(code);
    setRecoveryConfirmed(false);
    setShowRecoveryModal(true);
  }, []);

  const closeRecoveryModal = useCallback(() => {
    setShowRecoveryModal(false);
    setRecoveryCode("");
    setRecoveryConfirmed(false);
  }, []);

  /** Generate a new recovery code for the current vault key. */
  const handleCreateRecoveryCode = useCallback(
    async (vaultKeyBytes: Uint8Array, csrfToken: string) => {
      const code = generateRecoveryCode();
      const packet = await createRecoveryPacket(code, vaultKeyBytes);
      saveRecoveryPacket(packet);
      if (csrfToken) {
        await saveRecoveryPacketToServer(csrfToken, packet).catch(() => undefined);
      }
      showRecoveryCode(code);
    },
    [showRecoveryCode]
  );

  return {
    // State
    showRecoveryModal,
    recoveryCode,
    recoveryConfirmed,
    showRecoveryEntry,
    setShowRecoveryEntry,
    recoveryInputCode,
    setRecoveryInputCode,
    recoveryPassword,
    setRecoveryPassword,
    // Actions
    showRecoveryCode,
    closeRecoveryModal,
    setRecoveryConfirmed,
    handleCreateRecoveryCode
  };
}
