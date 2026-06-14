"use client";

import { AlertTriangle, KeyRound, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { RecoveryPacketEnvelope } from "@zero-vault/shared";
import type { DesktopCryptoAdapter } from "../../lib/crypto/desktop-crypto-adapter";
import { Modal } from "../ui/modal";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import styles from "./recovery-modal.module.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRecover: (vaultKey: Uint8Array) => Promise<void>;
  cryptoAdapter: DesktopCryptoAdapter;
  /** The encrypted recovery packet stored locally. */
  encryptedRecoveryPacket: RecoveryPacketEnvelope | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RecoveryModal({
  isOpen,
  onClose,
  onRecover,
  cryptoAdapter,
  encryptedRecoveryPacket,
}: RecoveryModalProps) {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setRecoveryCode("");
      setRecovering(false);
      setError(null);
    }
  }, [isOpen]);

  const handleRecover = useCallback(async () => {
    if (!recoveryCode.trim()) {
      setError("请输入恢复码");
      return;
    }

    if (!encryptedRecoveryPacket) {
      setError("未找到恢复数据包。请确认已设置恢复码。");
      return;
    }

    if (encryptedRecoveryPacket.alg === "AES_256_GCM") {
      setError("恢复数据包是旧版格式，请重新生成恢复数据包以使用当前版本。");
      return;
    }

    if (encryptedRecoveryPacket.alg !== "XCHACHA20_POLY1305") {
      setError("恢复数据包格式不受支持。");
      return;
    }

    setRecovering(true);
    setError(null);

    try {
      // Derive the recovery key from the user-provided code
      const recoveryKey = await cryptoAdapter.deriveRecoveryKey(recoveryCode.trim());

      // Decrypt the vault key using the recovery key
      const nonceBytes = base64urlToBytes(encryptedRecoveryPacket.nonce);
      const ciphertextBytes = base64urlToBytes(encryptedRecoveryPacket.ciphertext);

      const vaultKey = await cryptoAdapter.decryptRecoveryPacket(
        recoveryKey,
        nonceBytes,
        ciphertextBytes,
      );
      if (vaultKey.length !== 32) {
        throw new Error("恢复的密钥长度无效");
      }

      await onRecover(vaultKey);
      onClose();
    } catch {
      setError("恢复码无效或恢复数据已损坏。请检查恢复码后重试。");
    } finally {
      setRecovering(false);
    }
  }, [recoveryCode, encryptedRecoveryPacket, cryptoAdapter, onRecover, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && recoveryCode.trim() && !recovering) {
        void handleRecover();
      }
    },
    [recoveryCode, recovering, handleRecover],
  );

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title="恢复密码库"
      destructive
    >
      <div className={styles.content}>
        <div className={styles.warningBox}>
          <AlertTriangle size={16} />
          <span>
            输入恢复码以解封密码库。恢复码是在设置时生成的离线密钥。
          </span>
        </div>

        {!encryptedRecoveryPacket && (
          <div className={styles.errorBox}>
            <ShieldAlert size={16} />
            <span>未找到恢复数据包。可能尚未设置恢复码，或恢复数据已丢失。</span>
          </div>
        )}

        <div className={styles.inputSection}>
          <label className={styles.inputLabel} htmlFor="recovery-code-input">
            <KeyRound size={14} />
            恢复码
          </label>
          <Input
            id="recovery-code-input"
            type="text"
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="粘贴恢复码"
            autoComplete="off"
            spellCheck={false}
            {...(error ? { error } : {})}
          />
        </div>

        <div className={styles.infoBox}>
          <p className={styles.infoBoxTitle}>
            <ShieldAlert size={14} />
            恢复码安全提示
          </p>
          <ul className={styles.infoBoxList}>
            <li>恢复码不会发送到服务器</li>
            <li>解密过程完全在本地完成</li>
            <li>恢复码只能使用一次，使用后建议重新生成</li>
          </ul>
        </div>
      </div>

      <div className={styles.actions}>
        <Button variant="ghost" onClick={onClose}>
          取消
        </Button>
        <Button
          variant="primary"
          loading={recovering}
          disabled={!recoveryCode.trim() || !encryptedRecoveryPacket}
          onClick={() => void handleRecover()}
        >
          <KeyRound size={14} />
          恢复
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert base64url string to Uint8Array. */
function base64urlToBytes(b64: string): Uint8Array {
  const standard = b64.replace(/-/g, "+").replace(/_/g, "/");
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
