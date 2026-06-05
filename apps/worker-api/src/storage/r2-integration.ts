/**
 * Higher-level R2 integration for vault exports.
 *
 * Provides convenience functions that wrap R2Storage for common workflows:
 * - Creating a new export from encrypted vault data
 * - Retrieving an existing export
 * - Cleaning up old exports beyond a retention window
 *
 * Security: All data written through these helpers MUST already be encrypted
 * (ciphertext envelopes). This module never sees plaintext vault content.
 */

import { R2Storage } from "./r2-helpers";

/**
 * Create a new vault export in R2.
 *
 * @param storage - R2Storage instance
 * @param userId  - Owner of the export
 * @param exportId - UUID for this export
 * @param encryptedVaultData - Pre-encrypted ciphertext ArrayBuffer
 * @param algorithm - Encryption algorithm identifier (e.g. "XCHACHA20_POLY1305")
 * @returns Metadata stored alongside the export
 */
export async function exportVaultToR2(
  storage: R2Storage,
  userId: string,
  exportId: string,
  encryptedVaultData: ArrayBuffer,
  algorithm: string
): Promise<{ key: string; size: number; createdAt: string }> {
  const createdAt = new Date().toISOString();
  const size = encryptedVaultData.byteLength;

  const metadata: Record<string, string> = {
    alg: algorithm,
    ts: createdAt,
    size: String(size)
  };

  await storage.uploadExport(userId, exportId, encryptedVaultData, metadata);

  return {
    key: `exports/${userId}/${exportId}`,
    size,
    createdAt
  };
}

/**
 * Retrieve an encrypted vault export from R2.
 *
 * Returns null if the export does not exist.
 * The caller is responsible for decrypting the returned data.
 */
export async function importVaultFromR2(
  storage: R2Storage,
  userId: string,
  exportId: string
): Promise<{ data: ArrayBuffer; metadata: Record<string, string> } | null> {
  const object = await storage.downloadExport(userId, exportId);
  if (!object) {
    return null;
  }

  const data = await object.arrayBuffer();
  return {
    data,
    metadata: object.customMetadata ?? {}
  };
}

/**
 * Delete exports older than `maxAge` for a given user.
 *
 * Only the `ts` field in customMetadata is checked. Exports without a `ts`
 * metadata field are left untouched (conservative approach).
 *
 * @param storage - R2Storage instance
 * @param userId  - Owner whose exports to clean up
 * @param maxAge  - Maximum age in milliseconds
 * @returns List of exportIds that were deleted
 */
export async function cleanupOldExports(
  storage: R2Storage,
  userId: string,
  maxAge: number
): Promise<string[]> {
  const exports = await storage.listExports(userId);
  const cutoff = Date.now() - maxAge;
  const deleted: string[] = [];

  for (const obj of exports) {
    const ts = obj.customMetadata?.ts;
    if (!ts) {
      // No timestamp metadata — skip (conservative)
      continue;
    }

    const exportTime = new Date(ts).getTime();
    if (isNaN(exportTime)) {
      // Invalid timestamp — skip
      continue;
    }

    if (exportTime < cutoff) {
      // Extract exportId from key: exports/{userId}/{exportId}
      const segments = obj.key.split("/");
      const exportId = segments[2];
      if (exportId) {
        const success = await storage.deleteExport(userId, exportId);
        if (success) {
          deleted.push(exportId);
        }
      }
    }
  }

  return deleted;
}
