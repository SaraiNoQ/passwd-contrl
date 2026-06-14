/**
 * Offline mutation queue for Desktop Vault sync.
 *
 * Stores pending sync operation metadata (item IDs, types, timestamps, retry counts)
 * in localStorage. This queue intentionally stores ONLY mutation metadata -- it NEVER
 * stores plaintext passwords, keys, or any sensitive credential data.
 *
 * - Queue key: zero-vault.desktop.offline-queue.v1
 * - Max entries: 500
 * - Entry TTL: 7 days
 */

const STORAGE_KEY = "zero-vault.desktop.offline-queue.v1";
const MAX_QUEUE_SIZE = 500;
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface OfflineMutationEntry {
  type: "upsert" | "delete";
  itemId: string;
  timestamp: string;
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getStorage(): Storage {
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }
  throw new Error("localStorage is not available");
}

function readQueue(): OfflineMutationEntry[] {
  try {
    const raw = getStorage().getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is OfflineMutationEntry =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as OfflineMutationEntry).type !== undefined &&
        (entry as OfflineMutationEntry).itemId !== undefined,
    );
  } catch {
    return [];
  }
}

function writeQueue(entries: OfflineMutationEntry[]): void {
  getStorage().setItem(STORAGE_KEY, JSON.stringify(entries));
}

function cleanExpired(entries: OfflineMutationEntry[]): OfflineMutationEntry[] {
  const now = Date.now();
  return entries.filter(
    (entry) => now - new Date(entry.timestamp).getTime() < ENTRY_TTL_MS,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Add a mutation entry to the offline queue.
 * Replaces any existing entry for the same itemId.
 * Enforces max queue size by dropping oldest entries.
 */
export function enqueueOfflineMutation(entry: OfflineMutationEntry): void {
  let queue = readQueue();
  queue = cleanExpired(queue);

  const existingIndex = queue.findIndex((e) => e.itemId === entry.itemId);
  if (existingIndex >= 0) {
    queue[existingIndex] = entry;
  } else {
    queue.push(entry);
  }

  // Enforce max size -- remove oldest entries first
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift();
  }

  writeQueue(queue);
}

/**
 * Remove and return all non-expired entries from the queue.
 * After this call, the queue is emptied.
 */
export function dequeueOfflineMutations(): OfflineMutationEntry[] {
  const queue = readQueue();
  const active = cleanExpired(queue);
  getStorage().removeItem(STORAGE_KEY);
  return active;
}

/**
 * Count the number of non-expired entries currently in the queue.
 */
export function getOfflineQueueSize(): number {
  const queue = readQueue();
  return cleanExpired(queue).length;
}

/**
 * Returns true when the queue has at least one non-expired entry.
 */
export function hasOfflineMutations(): boolean {
  return getOfflineQueueSize() > 0;
}

/**
 * Return all entries (including expired ones) so callers can introspect
 * retryCount. Used by the hook to compute failedCount.
 */
export function peekAllEntries(): OfflineMutationEntry[] {
  return readQueue();
}

/**
 * Persist an array of entries, overwriting whatever was in the queue.
 * Used by the hook to atomically replace the queue after re-enqueuing
 * entries with incremented retry counts.
 */
export function writeAllEntries(entries: OfflineMutationEntry[]): void {
  // Clean expired entries before persisting
  writeQueue(cleanExpired(entries));
}

/**
 * Completely clear the offline queue from localStorage.
 */
export function clearOfflineQueue(): void {
  getStorage().removeItem(STORAGE_KEY);
}
