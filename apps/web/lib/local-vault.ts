export * from "@zero-vault/browser-vault/local-vault";
import { LOCAL_VAULT_STORAGE_KEY, sealUnlockedVault, type EncryptedLocalVault, type UnlockedVault } from "@zero-vault/browser-vault/local-vault";

export const saveEncryptedLocalVault = (vault: EncryptedLocalVault) => {
  window.localStorage.setItem(LOCAL_VAULT_STORAGE_KEY, JSON.stringify(vault));
};

export const loadEncryptedLocalVault = (): EncryptedLocalVault | null => {
  const raw = window.localStorage.getItem(LOCAL_VAULT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as EncryptedLocalVault;
  if (
    parsed.schemaVersion !== 1 ||
    (parsed.runtime !== "webcrypto-mvp" && parsed.runtime !== "crypto-core-wasm")
  ) {
    throw new Error("Unsupported local vault version.");
  }

  return parsed;
};

export const persistUnlockedVault = async (vault: UnlockedVault): Promise<{
  encrypted: EncryptedLocalVault;
  unlocked: UnlockedVault;
}> => {
  const encrypted = await sealUnlockedVault(vault);
  saveEncryptedLocalVault(encrypted);
  return {
    encrypted,
    unlocked: {
      ...vault,
      snapshot: {
        ...vault.snapshot,
        updatedAt: encrypted.updatedAt
      }
    }
  };
};
