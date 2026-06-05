/**
 * Pure auth-related vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  createEmptyLocalVault,
  loadEncryptedLocalVault,
  saveEncryptedLocalVault,
  unlockLocalVault,
  type EncryptedLocalVault,
  type UnlockedVault
} from "./local-vault";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateVaultResult = {
  encrypted: EncryptedLocalVault;
  unlocked: UnlockedVault;
};

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Create a new empty local vault encrypted with the given master password.
 * Validates password length, creates the vault, and persists to localStorage.
 */
export async function handleCreateVault(
  masterPassword: string
): Promise<CreateVaultResult> {
  if (masterPassword.length < 12) {
    throw new Error("主密码至少需要 12 个字符。");
  }
  const created = await createEmptyLocalVault(masterPassword);
  saveEncryptedLocalVault(created.encrypted);
  return created;
}

/**
 * Unlock an existing encrypted vault with the master password.
 * Throws if the password is wrong or the vault is corrupt.
 */
export async function handleUnlockVault(
  masterPassword: string,
  encryptedVault: EncryptedLocalVault
): Promise<UnlockedVault> {
  return unlockLocalVault(masterPassword, encryptedVault);
}

/**
 * Load the encrypted vault from localStorage.
 * Returns null if no vault exists.
 */
export function handleLoadExistingVault(): EncryptedLocalVault | null {
  return loadEncryptedLocalVault();
}
