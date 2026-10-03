/**
 * Pure recovery-related vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  fetchRecoveryPacket,
  pullVault
} from "./api-client";
import {
  createEmptyLocalVault,
  LOCAL_VAULT_STORAGE_KEY,
  saveEncryptedLocalVault,
  sealUnlockedVault,
  unlockLocalVaultWithRecoveredKey,
  validateEncryptedBackup,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultItem
} from "./local-vault";
import {
  getSyncedLocalVaultItem,
  loadItemRevisionMap,
  loadPendingItemMutations,
  mergeRemoteItems,
  saveItemRevisionMap,
  savePendingItemMutations,
  syncItemToEncryptedVault
} from "./sync-vault";
import { toArrayBuffer } from "./crypto-utils";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  recoverVaultKey,
  saveRecoveryPacket,
  loadRecoveryPacket,
  LEGACY_RECOVERY_MIGRATION_MESSAGE,
  LEGACY_RECOVERY_PROTOCOL,
  RECOVERY_PACKET_STORAGE_KEY
} from "./recovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateRecoveryCodeResult = {
  code: string;
  recoveryProtocol: typeof LEGACY_RECOVERY_PROTOCOL;
  serverUploadAttempted: false;
  migrationRequired: true;
  migrationMessage: typeof LEGACY_RECOVERY_MIGRATION_MESSAGE;
};

export type RecoverVaultResult =
  | {
      status: "ok";
      encrypted: EncryptedLocalVault;
      unlocked: UnlockedVault;
      recoveredCount: number;
      recoveryCode: string;
      recoveryProtocol: typeof LEGACY_RECOVERY_PROTOCOL;
      serverUploadAttempted: false;
      migrationRequired: true;
      migrationMessage: typeof LEGACY_RECOVERY_MIGRATION_MESSAGE;
    }
  | { status: "no-code" }
  | { status: "no-packet" }
  | { status: "recovery-v2-managed"; message: string }
  | { status: "password-too-short" }
  | { status: "remote-only-unsupported"; message: string }
  | { status: "remote-items-failed"; message: string; failedItemIds: string[] }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Generate a recovery code and create an encrypted recovery packet.
 * Saves the legacy packet locally. Upload is deliberately blocked because the
 * Worker endpoint accepts Recovery v2 material that the Web runtime cannot
 * produce.
 */
export async function handleCreateRecoveryCode(deps: {
  unlockedVault: UnlockedVault;
  csrfToken: string;
}): Promise<CreateRecoveryCodeResult> {
  const { unlockedVault } = deps;

  const vaultKeyBytes =
    unlockedVault.runtime === "webcrypto-mvp"
      ? new Uint8Array(
          await crypto.subtle.exportKey("raw", unlockedVault.key)
        )
      : unlockedVault.key;

  const code = generateRecoveryCode();
  const packet = await createRecoveryPacket(code, vaultKeyBytes);
  saveRecoveryPacket(packet);

  return {
    code,
    recoveryProtocol: LEGACY_RECOVERY_PROTOCOL,
    serverUploadAttempted: false,
    migrationRequired: true,
    migrationMessage: LEGACY_RECOVERY_MIGRATION_MESSAGE
  };
}

/**
 * Recover a vault from a recovery code.
 * Loads the recovery packet, decrypts the vault key, recovers items,
 * and creates a new vault encrypted with the new password.
 */
export async function handleRecoverVault(deps: {
  recoveryInputCode: string;
  recoveryPassword: string;
  encryptedVault: EncryptedLocalVault | null;
  csrfToken: string;
}): Promise<RecoverVaultResult> {
  const { recoveryInputCode, recoveryPassword, encryptedVault } = deps;
  let remoteOriginalRevisionMap: Record<string, number> | null = null;

  if (!recoveryInputCode) {
    return { status: "no-code" };
  }

  if (recoveryPassword.length < 12) {
    return { status: "password-too-short" };
  }

  try {
    let packet = loadRecoveryPacket();
    if (!packet) {
      try {
        packet = await fetchRecoveryPacket();
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "recovery_v2_managed") {
          return {
            status: "recovery-v2-managed",
            message: "服务器上的恢复材料已升级为 Recovery v2，旧版 Web 客户端无法打开。请使用 Android 客户端完成恢复。"
          };
        }
        const fetchErrorMessages: Record<string, string> = {
          not_authenticated: "登录状态已过期，无法从服务器读取恢复包。请重新登录后重试。",
          request_failed_401: "登录状态已过期，无法从服务器读取恢复包。请重新登录后重试。",
          network_error: "无法连接服务器读取恢复包。请检查网络后重试；本机数据未被修改。",
          request_timeout: "读取服务器恢复包超时。请检查网络后重试；本机数据未被修改。",
          recovery_packet_response_invalid: "服务器返回的恢复包格式无效。已安全中止恢复，本机数据未被修改。"
        };
        const message =
          fetchErrorMessages[code] ??
          "读取服务器恢复包失败。已安全中止恢复，本机数据未被修改。";
        return { status: "error", message };
      }
    }
    if (!packet) {
      return { status: "no-packet" };
    }

    const vaultKeyBytes = await recoverVaultKey(recoveryInputCode, packet);

    let recoveredItems: VaultItem[] = [];
    if (encryptedVault) {
      const recoveredLocalVault = await unlockLocalVaultWithRecoveredKey(
        encryptedVault,
        vaultKeyBytes
      );
      recoveredItems = recoveredLocalVault.snapshot.items;
    } else {
      const remote = await pullVault();
      const syncedLocalVaultItem = getSyncedLocalVaultItem(remote.items);
      let remoteVault: UnlockedVault;
      if (syncedLocalVaultItem) {
        const remoteEncryptedVault = syncItemToEncryptedVault(syncedLocalVaultItem);
        if (!validateEncryptedBackup(remoteEncryptedVault)) {
          return {
            status: "remote-only-unsupported",
            message: "云端旧版密码库格式无法可靠识别；本机数据未被修改。请在原设备导出密码库后迁移。"
          };
        }
        remoteVault = await unlockLocalVaultWithRecoveredKey(
          remoteEncryptedVault,
          vaultKeyBytes
        );
      } else {
        const remoteItems = remote.items;
        const algorithms = new Set(
          remoteItems.flatMap((item) => [
            item.encryptedItemKey.alg,
            item.encryptedPayload.alg
          ])
        );
        const [algorithm] = algorithms;
        if (
          remoteItems.length === 0 ||
          algorithms.size !== 1 ||
          (algorithm !== "AES_256_GCM" && algorithm !== "XCHACHA20_POLY1305")
        ) {
          return {
            status: "remote-only-unsupported",
            message: "无法可靠判断云端旧版密码库的加密协议；本机数据未被修改。请在原设备导出密码库后迁移。"
          };
        }

        if (algorithm === "XCHACHA20_POLY1305") {
          remoteVault = {
            runtime: "crypto-core-wasm",
            key: vaultKeyBytes,
            kdf: {
              alg: "ARGON2ID_V13",
              memoryKib: 19456,
              iterations: 2,
              parallelism: 1,
              salt: ""
            },
            snapshot: {
              schemaVersion: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              items: []
            }
          };
        } else {
          const key = await globalThis.crypto.subtle.importKey(
            "raw",
            toArrayBuffer(vaultKeyBytes),
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
          remoteVault = {
            runtime: "webcrypto-mvp",
            key,
            kdf: {
              alg: "PBKDF2_SHA256",
              iterations: 600_000,
              salt: ""
            },
            snapshot: {
              schemaVersion: 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              items: []
            }
          };
        }

      }

      const originalRevisionMap = loadItemRevisionMap();
      remoteOriginalRevisionMap = originalRevisionMap;
      const { vault: merged, failedItemIds } = await mergeRemoteItems(
        remoteVault,
        remote.items
      );
      if (failedItemIds.length > 0) {
        saveItemRevisionMap(originalRevisionMap);
        remoteOriginalRevisionMap = null;
        return {
          status: "remote-items-failed",
          failedItemIds,
          message: `有 ${failedItemIds.length} 条云端记录无法解密；本机数据未被修改。请回到原设备完成迁移。`
        };
      }
      recoveredItems = merged.snapshot.items;
    }

    const created = await createEmptyLocalVault(recoveryPassword);
    const restoredVault: UnlockedVault = {
      ...created.unlocked,
      snapshot: {
        ...created.unlocked.snapshot,
        // Re-generating entries here used to discard notes/cards and replace
        // login IDs plus timestamps. The decrypted items are already complete
        // VaultItem values, so preserve them byte-for-byte.
        items: recoveredItems
      }
    };

    const newVaultKeyBytes =
      restoredVault.runtime === "webcrypto-mvp"
        ? new Uint8Array(await crypto.subtle.exportKey("raw", restoredVault.key))
        : restoredVault.key;
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryPacket = await createRecoveryPacket(newRecoveryCode, newVaultKeyBytes);
    const verifiedNewVaultKey = await recoverVaultKey(newRecoveryCode, newRecoveryPacket);
    if (
      verifiedNewVaultKey.length !== newVaultKeyBytes.length ||
      !verifiedNewVaultKey.every((byte, index) => byte === newVaultKeyBytes[index])
    ) {
      throw new Error("新恢复包校验失败；本机数据未被修改。");
    }

    const encrypted = await sealUnlockedVault(restoredVault);
    const persistedUnlocked: UnlockedVault = {
      ...restoredVault,
      snapshot: {
        ...restoredVault.snapshot,
        updatedAt: encrypted.updatedAt
      }
    };

    const previousVault = window.localStorage.getItem(LOCAL_VAULT_STORAGE_KEY);
    const previousRecoveryPacket = window.localStorage.getItem(RECOVERY_PACKET_STORAGE_KEY);
    const previousPendingMutations = loadPendingItemMutations();
    try {
      // Pending envelopes are bound to the old vault key and must never replay.
      savePendingItemMutations({});
      saveEncryptedLocalVault(encrypted);
      saveRecoveryPacket(newRecoveryPacket);
      savePendingItemMutations({});
    } catch (commitError) {
      let rollbackFailed = false;
      for (const [key, value] of [
        [LOCAL_VAULT_STORAGE_KEY, previousVault],
        [RECOVERY_PACKET_STORAGE_KEY, previousRecoveryPacket]
      ] as const) {
        try {
          if (value === null) {
            window.localStorage.removeItem(key);
          } else {
            window.localStorage.setItem(key, value);
          }
        } catch {
          rollbackFailed = true;
        }
      }
      try {
        savePendingItemMutations(previousPendingMutations);
      } catch {
        rollbackFailed = true;
      }
      if (rollbackFailed) {
        throw new Error("恢复提交失败，且本地回滚未完整完成。请勿关闭页面并立即导出当前本地数据。");
      }
      throw commitError;
    }

    return {
      status: "ok",
      encrypted,
      unlocked: persistedUnlocked,
      recoveredCount: recoveredItems.length,
      recoveryCode: newRecoveryCode,
      recoveryProtocol: LEGACY_RECOVERY_PROTOCOL,
      serverUploadAttempted: false,
      migrationRequired: true,
      migrationMessage: LEGACY_RECOVERY_MIGRATION_MESSAGE
    };
  } catch (e) {
    if (remoteOriginalRevisionMap) {
      try {
        saveItemRevisionMap(remoteOriginalRevisionMap);
      } catch {
        return {
          status: "error",
          message: "恢复失败，且同步版本元数据未能回滚。请勿继续同步，并立即导出当前本地数据。"
        };
      }
    }
    return {
      status: "error",
      message: e instanceof Error ? e.message : "恢复失败。请检查恢复码。"
    };
  }
}
