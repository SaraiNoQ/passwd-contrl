/**
 * Pure settings, export, and import vault operations.
 * Each function accepts dependencies as parameters and returns a result object.
 * No React hooks or state management — that stays in vault-provider.tsx.
 */
import {
  addCredential,
  createEmptyLocalVault,
  persistUnlockedVault,
  saveEncryptedLocalVault,
  sealUnlockedVault,
  unlockLocalVault,
  validateEncryptedBackup,
  type EncryptedLocalVault,
  type UnlockedVault
} from "./local-vault";
import { isLogin } from "./item-types";
import { detectImportFormat, parsePasswordImport } from "./password-import";
import { deleteAccount } from "./api-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ImportPasswordsResult =
  | {
      status: "ok";
      importedCount: number;
      skippedCount: number;
      format: string;
      updatedVault: { encrypted: EncryptedLocalVault; unlocked: UnlockedVault };
    }
  | { status: "unknown-format" }
  | { status: "error"; message: string };

export type ChangeMasterPasswordResult =
  | {
      status: "ok";
      encrypted: EncryptedLocalVault;
      unlocked: UnlockedVault;
    }
  | { status: "wrong-current-password" }
  | { status: "error"; message: string };

export type ImportBackupResult =
  | { status: "ok"; encrypted: EncryptedLocalVault }
  | { status: "invalid" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function itemsToCsv(
  items: Array<{ title: string; origin: string; username: string; password: string; notes: string }>
): string {
  const header = "name,url,username,password,note";
  const rows = items.map((item) =>
    [item.title, item.origin, item.username, item.password, item.notes]
      .map((v) => `"${v.replace(/"/g, '""')}"`)
      .join(",")
  );
  return [header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// Export functions
// ---------------------------------------------------------------------------

/**
 * Export all login items as a CSV file download.
 */
export function handleExportCsv(unlockedVault: UnlockedVault): void {
  const loginItems = unlockedVault.snapshot.items.filter(isLogin);
  const csv = itemsToCsv(loginItems);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, `zero-vault-export-${new Date().toISOString().slice(0, 10)}.csv`);
}

/**
 * Export the encrypted vault as a JSON backup file download.
 */
export function handleExportEncrypted(encryptedVault: EncryptedLocalVault): void {
  const blob = new Blob([JSON.stringify(encryptedVault)], {
    type: "application/json"
  });
  downloadBlob(
    blob,
    `zero-vault-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}

/**
 * Export selected login items as a CSV file download.
 */
export function handleExportCsvSelected(
  unlockedVault: UnlockedVault,
  selectedIds: Set<string>
): void {
  if (selectedIds.size === 0) return;
  const selectedItems = unlockedVault.snapshot.items
    .filter(isLogin)
    .filter((item) => selectedIds.has(item.id));
  const csv = itemsToCsv(selectedItems);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(
    blob,
    `zero-vault-selected-export-${new Date().toISOString().slice(0, 10)}.csv`
  );
}

/**
 * Export selected items as an encrypted backup file download.
 */
export async function handleExportEncryptedSelected(
  unlockedVault: UnlockedVault,
  selectedIds: Set<string>
): Promise<void> {
  if (selectedIds.size === 0) return;
  const selectedItems = unlockedVault.snapshot.items.filter((item) =>
    selectedIds.has(item.id)
  );
  const tempVault: UnlockedVault = {
    ...unlockedVault,
    snapshot: {
      ...unlockedVault.snapshot,
      items: selectedItems
    }
  } as UnlockedVault;
  const encrypted = await sealUnlockedVault(tempVault);
  const blob = new Blob([JSON.stringify(encrypted)], {
    type: "application/json"
  });
  downloadBlob(
    blob,
    `zero-vault-selected-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}

// ---------------------------------------------------------------------------
// Import functions
// ---------------------------------------------------------------------------

/**
 * Import passwords from a file (Bitwarden JSON, 1Password CSV, browser CSV, generic JSON).
 * Returns the updated vault with imported items added.
 */
export async function handleImportPasswords(
  file: File,
  unlockedVault: UnlockedVault
): Promise<ImportPasswordsResult> {
  try {
    const content = await file.text();
    const format = detectImportFormat(content, file.name);
    if (format === "unknown") {
      return { status: "unknown-format" };
    }

    const parsed = parsePasswordImport(content, format);
    const validRows = parsed.rows.filter((row) => {
      try {
        const url = new URL(row.origin);
        return (
          url.protocol === "https:" &&
          row.username.trim().length > 0 &&
          row.password.trim().length > 0
        );
      } catch {
        return false;
      }
    });
    const skippedRows = parsed.rejected + (parsed.rows.length - validRows.length);

    let nextVault = unlockedVault;
    for (const row of validRows) {
      nextVault = addCredential(nextVault, {
        title: row.title ?? new URL(row.origin).hostname,
        origin: row.origin,
        username: row.username,
        password: row.password,
        notes: row.notes ?? ""
      });
    }

    const persisted = await persistUnlockedVault(nextVault);

    const formatLabels: Record<string, string> = {
      bitwarden: "Bitwarden JSON",
      "1password": "1Password",
      csv: "CSV",
      "generic-json": "JSON"
    };

    return {
      status: "ok",
      importedCount: validRows.length,
      skippedCount: skippedRows,
      format: formatLabels[format] ?? "未知",
      updatedVault: { encrypted: persisted.encrypted, unlocked: persisted.unlocked }
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "导入失败。"
    };
  }
}

/**
 * Import an encrypted backup file.
 * Validates the backup format and saves it to localStorage.
 */
export async function handleImportEncryptedBackup(
  file: File
): Promise<ImportBackupResult> {
  try {
    const text = await file.text();
    const data = JSON.parse(text) as unknown;
    if (!validateEncryptedBackup(data)) {
      return { status: "invalid" };
    }
    saveEncryptedLocalVault(data);
    return { status: "ok", encrypted: data };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "导入加密备份失败。"
    };
  }
}

// ---------------------------------------------------------------------------
// Settings functions
// ---------------------------------------------------------------------------

/**
 * Change the master password.
 * Verifies the current password, creates a new vault with the new password,
 * and preserves the existing snapshot.
 */
export async function handleChangeMasterPassword(deps: {
  currentPassword: string;
  newPassword: string;
  encryptedVault: EncryptedLocalVault;
  unlockedVault: UnlockedVault | null;
}): Promise<ChangeMasterPasswordResult> {
  const { currentPassword, newPassword, encryptedVault, unlockedVault } = deps;

  try {
    await unlockLocalVault(currentPassword, encryptedVault);
  } catch {
    return { status: "wrong-current-password" };
  }

  try {
    const created = await createEmptyLocalVault(newPassword);
    if (unlockedVault) {
      const persisted = await persistUnlockedVault({
        ...created.unlocked,
        snapshot: unlockedVault.snapshot
      });
      saveEncryptedLocalVault(persisted.encrypted);
      return {
        status: "ok",
        encrypted: persisted.encrypted,
        unlocked: persisted.unlocked
      };
    }
    return {
      status: "ok",
      encrypted: created.encrypted,
      unlocked: created.unlocked
    };
  } catch (e) {
    return {
      status: "error",
      message: e instanceof Error ? e.message : "修改主密码失败。"
    };
  }
}

/**
 * Delete the user's account from the server and clear all local data.
 * Returns success even if the server deletion fails (local data is always cleared).
 */
export async function handleDeleteAccount(csrfToken: string): Promise<void> {
  if (csrfToken) {
    try {
      await deleteAccount(csrfToken);
    } catch {
      // Server deletion failed; still clear local data
    }
  }

  const keysToRemove = [
    "zero-vault.local.encrypted-vault.v1",
    "zero-vault.local.sync-revision.v1",
    "zero-vault.local.item-revisions.v1",
    "zero-vault.local.conflict-ids.v1",
    "zero-vault.local.last-synced-at.v1",
    "zero-vault.local.recovery-packet.v1",
    "zero-vault.settings.auto-lock-timeout",
    "zero-vault.settings.auto-sync-enabled",
    "zero-vault.settings.sync-interval",
    "zero-vault.settings.extension-id"
  ];
  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}
