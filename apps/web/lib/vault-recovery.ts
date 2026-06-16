/**
 * Pure recovery-related vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  fetchRecoveryPacket,
  pullVault,
  saveRecoveryPacketToServer
} from "./api-client";
import {
  addCredential,
  createEmptyLocalVault,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  unlockLocalVaultWithRecoveredKey,
  type EncryptedLocalVault,
  type UnlockedVault,
  type VaultItem
} from "./local-vault";
import { isLogin } from "./item-types";
import { mergeRemoteItems } from "./sync-vault";
import {
  generateRecoveryCode,
  createRecoveryPacket,
  recoverVaultKey,
  saveRecoveryPacket,
  loadRecoveryPacket
} from "./recovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateRecoveryCodeResult = {
  code: string;
};

export type RecoverVaultResult =
  | {
      status: "ok";
      encrypted: EncryptedLocalVault;
      unlocked: UnlockedVault;
      recoveredCount: number;
      recoveryCode: string;
      serverSaveFailed: boolean;
    }
  | { status: "no-code" }
  | { status: "no-packet" }
  | { status: "password-too-short" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Generate a recovery code and create an encrypted recovery packet.
 * Saves the packet locally and optionally to the server.
 */
export async function handleCreateRecoveryCode(deps: {
  unlockedVault: UnlockedVault;
  csrfToken: string;
}): Promise<CreateRecoveryCodeResult> {
  const { unlockedVault, csrfToken } = deps;

  const vaultKeyBytes =
    unlockedVault.runtime === "webcrypto-mvp"
      ? new Uint8Array(
          await crypto.subtle.exportKey("raw", unlockedVault.key)
        )
      : unlockedVault.key;

  const code = generateRecoveryCode();
  const packet = await createRecoveryPacket(code, vaultKeyBytes);
  saveRecoveryPacket(packet);

  if (csrfToken) {
    await saveRecoveryPacketToServer(csrfToken, packet).catch(
      () => undefined
    );
  }

  return { code };
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
  const { recoveryInputCode, recoveryPassword, encryptedVault, csrfToken } = deps;

  if (!recoveryInputCode) {
    return { status: "no-code" };
  }

  if (recoveryPassword.length < 12) {
    return { status: "password-too-short" };
  }

  try {
    let packet = loadRecoveryPacket();
    if (!packet) {
      packet = await fetchRecoveryPacket();
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
      if (remote.items.length > 0) {
        const tempVault: UnlockedVault = {
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
        const { vault: merged } = await mergeRemoteItems(
          tempVault,
          remote.items
        );
        recoveredItems = merged.snapshot.items;
      }
    }

    const created = await createEmptyLocalVault(recoveryPassword);
    let restoredVault = created.unlocked;
    for (const item of recoveredItems) {
      if (isLogin(item)) {
        restoredVault = addCredential(restoredVault, {
          title: item.title,
          origin: item.origin,
          username: item.username,
          password: item.password,
          notes: item.notes
        });
      }
    }

    const persisted = await persistUnlockedVault(restoredVault);
    saveEncryptedLocalVault(persisted.encrypted);

    const newVaultKeyBytes =
      persisted.unlocked.runtime === "webcrypto-mvp"
        ? new Uint8Array(await crypto.subtle.exportKey("raw", persisted.unlocked.key))
        : persisted.unlocked.key;
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryPacket = await createRecoveryPacket(newRecoveryCode, newVaultKeyBytes);
    saveRecoveryPacket(newRecoveryPacket);

    let serverSaveFailed = false;
    if (csrfToken) {
      await saveRecoveryPacketToServer(csrfToken, newRecoveryPacket).catch(
        () => { serverSaveFailed = true; }
      );
    }

    return {
      status: "ok",
      encrypted: persisted.encrypted,
      unlocked: persisted.unlocked,
      recoveredCount: recoveredItems.length,
      recoveryCode: newRecoveryCode,
      serverSaveFailed
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "恢复失败。请检查恢复码。"
    };
  }
}
