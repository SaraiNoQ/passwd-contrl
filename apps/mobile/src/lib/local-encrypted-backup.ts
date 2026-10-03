import { z } from "zod";

export const LOCAL_ENCRYPTED_BACKUP_FORMAT = "zero-vault-personal-android-backup" as const;
export const MAX_LOCAL_ENCRYPTED_BACKUP_BYTES = 52 * 1_048_576;
export const MAX_CRYPTO_CORE_IMPORT_BYTES = 8 * 1_048_576;

const localEncryptedBackupSchema = z.object({
  format: z.literal(LOCAL_ENCRYPTED_BACKUP_FORMAT),
  version: z.literal(1),
  accountId: z.string().min(1).max(256),
  backupId: z.string().uuid(),
  createdAt: z.string().datetime({ offset: true }),
  encryptedSnapshot: z.string().min(1).max(50 * 1_048_576),
}).strict();

export type LocalEncryptedBackup = z.infer<typeof localEncryptedBackupSchema>;

export function serializeLocalEncryptedBackup(backup: LocalEncryptedBackup): string {
  const serialized = JSON.stringify(localEncryptedBackupSchema.parse(backup));
  requireByteLimit(serialized, MAX_LOCAL_ENCRYPTED_BACKUP_BYTES);
  return serialized;
}

export function parseLocalEncryptedBackup(serialized: string): LocalEncryptedBackup {
  requireByteLimit(serialized, MAX_LOCAL_ENCRYPTED_BACKUP_BYTES);
  return localEncryptedBackupSchema.parse(JSON.parse(serialized) as unknown);
}

export function requireByteLimit(value: string, maximum: number): void {
  if (!value || new TextEncoder().encode(value).byteLength > maximum) {
    throw new Error("backup_file_too_large");
  }
}
