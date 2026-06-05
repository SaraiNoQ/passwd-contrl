/**
 * R2 storage helpers for encrypted vault exports and backups.
 *
 * Security constraints:
 * - R2 ONLY stores encrypted data (ciphertext envelopes)
 * - NEVER store plaintext password, origin, username, notes, master password,
 *   derived key, or recovery code in R2
 * - Object keys must not reveal semantic information (use UUIDs)
 * - Metadata should only contain: algorithm, timestamp, size — no content hints
 * - Different users' data must be isolated by key prefix
 */

// Object key rules:
// - Use UUID-based keys, never expose origin/username/title
// - Format: exports/{userId}/{exportId}
// - Format: backups/{userId}/{backupId}
// - Format: attachments/{userId}/{attachmentId} (future)

export class R2Storage {
  constructor(private bucket: R2Bucket) {}

  // ── Exports ──────────────────────────────────────────────────────────────

  /**
   * Upload an encrypted export to R2.
   * @param userId - Owner of the export
   * @param exportId - UUID for this export
   * @param data - Encrypted ciphertext ArrayBuffer
   * @param metadata - Optional metadata (algorithm, timestamp, size only)
   */
  async uploadExport(
    userId: string,
    exportId: string,
    data: ArrayBuffer,
    metadata?: Record<string, string>
  ): Promise<void> {
    const key = this.exportKey(userId, exportId);
    await this.bucket.put(key, data, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: metadata
    });
  }

  /**
   * Download an encrypted export from R2.
   * Returns null if the object does not exist.
   */
  async downloadExport(
    userId: string,
    exportId: string
  ): Promise<R2ObjectBody | null> {
    const key = this.exportKey(userId, exportId);
    return this.bucket.get(key);
  }

  /**
   * Delete an encrypted export from R2.
   * Returns true if the key was deleted, false if it didn't exist.
   */
  async deleteExport(userId: string, exportId: string): Promise<boolean> {
    const key = this.exportKey(userId, exportId);
    const existing = await this.bucket.get(key);
    if (!existing) {
      return false;
    }
    await this.bucket.delete(key);
    return true;
  }

  /**
   * List all exports for a user.
   */
  async listExports(userId: string): Promise<R2Object[]> {
    const prefix = `exports/${userId}/`;
    const listed = await this.bucket.list({ prefix });
    return listed.objects;
  }

  // ── Backups ──────────────────────────────────────────────────────────────

  /**
   * Upload an encrypted backup to R2.
   */
  async uploadBackup(
    userId: string,
    backupId: string,
    data: ArrayBuffer,
    metadata?: Record<string, string>
  ): Promise<void> {
    const key = this.backupKey(userId, backupId);
    await this.bucket.put(key, data, {
      httpMetadata: { contentType: "application/octet-stream" },
      customMetadata: metadata
    });
  }

  /**
   * Download an encrypted backup from R2.
   * Returns null if the object does not exist.
   */
  async downloadBackup(
    userId: string,
    backupId: string
  ): Promise<R2ObjectBody | null> {
    const key = this.backupKey(userId, backupId);
    return this.bucket.get(key);
  }

  /**
   * Delete an encrypted backup from R2.
   * Returns true if the key was deleted, false if it didn't exist.
   */
  async deleteBackup(userId: string, backupId: string): Promise<boolean> {
    const key = this.backupKey(userId, backupId);
    const existing = await this.bucket.get(key);
    if (!existing) {
      return false;
    }
    await this.bucket.delete(key);
    return true;
  }

  // ── Key builders ─────────────────────────────────────────────────────────

  private exportKey(userId: string, exportId: string): string {
    return `exports/${userId}/${exportId}`;
  }

  private backupKey(userId: string, backupId: string): string {
    return `backups/${userId}/${backupId}`;
  }
}
