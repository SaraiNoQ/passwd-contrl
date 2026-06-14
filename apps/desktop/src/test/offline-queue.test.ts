import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueOfflineMutation,
  dequeueOfflineMutations,
  getOfflineQueueSize,
  hasOfflineMutations,
  peekAllEntries,
  writeAllEntries,
  clearOfflineQueue,
  type OfflineMutationEntry,
} from "../lib/offline-queue";

const STORAGE_KEY = "zero-vault.desktop.offline-queue.v1";

function setupStorage() {
  const store = new Map<string, string>();
  const ls = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
  vi.stubGlobal("window", { localStorage: ls });
  vi.stubGlobal("localStorage", ls);
  return store;
}

function makeEntry(overrides: Partial<OfflineMutationEntry> = {}): OfflineMutationEntry {
  return {
    type: "upsert",
    itemId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    retryCount: 0,
    ...overrides,
  };
}

describe("offline-queue", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = setupStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("enqueueOfflineMutation", () => {
    it("adds a single entry to the queue", () => {
      const entry = makeEntry();
      enqueueOfflineMutation(entry);

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe(entry.itemId);
      expect(entries[0]!.type).toBe("upsert");
    });

    it("replaces an existing entry with the same itemId", () => {
      const entry1 = makeEntry({ type: "upsert", itemId: "item-1" });
      enqueueOfflineMutation(entry1);

      const entry2 = makeEntry({ type: "delete", itemId: "item-1", retryCount: 3 });
      enqueueOfflineMutation(entry2);

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.type).toBe("delete");
      expect(entries[0]!.retryCount).toBe(3);
    });

    it("supports both upsert and delete types", () => {
      enqueueOfflineMutation(makeEntry({ type: "upsert", itemId: "a" }));
      enqueueOfflineMutation(makeEntry({ type: "delete", itemId: "b" }));

      const entries = peekAllEntries();
      expect(entries).toHaveLength(2);
      const types = entries.map((e) => e.type).sort();
      expect(types).toEqual(["delete", "upsert"]);
    });

    it("enforces max queue size by dropping oldest entries", () => {
      // Add 501 entries (max is 500)
      for (let i = 0; i < 501; i++) {
        enqueueOfflineMutation(makeEntry({ itemId: `item-${i}` }));
      }

      const entries = peekAllEntries();
      expect(entries.length).toBeLessThanOrEqual(500);
      // The first entry (item-0) should have been dropped
      const ids = entries.map((e) => e.itemId);
      expect(ids).not.toContain("item-0");
      expect(ids).toContain("item-500");
    });
  });

  describe("dequeueOfflineMutations", () => {
    it("returns all entries and clears the queue", () => {
      enqueueOfflineMutation(makeEntry({ itemId: "a" }));
      enqueueOfflineMutation(makeEntry({ itemId: "b" }));

      const dequeued = dequeueOfflineMutations();
      expect(dequeued).toHaveLength(2);

      // Queue should be empty after dequeue
      expect(getOfflineQueueSize()).toBe(0);
      expect(hasOfflineMutations()).toBe(false);
    });

    it("filters out expired entries", () => {
      const expired = makeEntry({
        itemId: "expired",
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago
      });
      const valid = makeEntry({ itemId: "valid" });

      // Write directly to avoid cleanExpired in enqueue
      writeAllEntries([expired, valid]);

      const dequeued = dequeueOfflineMutations();
      expect(dequeued).toHaveLength(1);
      expect(dequeued[0]!.itemId).toBe("valid");

      // Queue should be cleared (expired items removed permanently)
      expect(getOfflineQueueSize()).toBe(0);
    });

    it("returns empty array when queue is empty", () => {
      const dequeued = dequeueOfflineMutations();
      expect(dequeued).toEqual([]);
    });
  });

  describe("getOfflineQueueSize", () => {
    it("returns 0 for empty queue", () => {
      expect(getOfflineQueueSize()).toBe(0);
    });

    it("counts only non-expired entries", () => {
      const expired = makeEntry({
        itemId: "old",
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const valid = makeEntry({ itemId: "new" });

      writeAllEntries([expired, valid]);

      expect(getOfflineQueueSize()).toBe(1);
    });
  });

  describe("hasOfflineMutations", () => {
    it("returns false when queue is empty", () => {
      expect(hasOfflineMutations()).toBe(false);
    });

    it("returns true when there are entries", () => {
      enqueueOfflineMutation(makeEntry());
      expect(hasOfflineMutations()).toBe(true);
    });
  });

  describe("peekAllEntries", () => {
    it("returns all entries without clearing", () => {
      enqueueOfflineMutation(makeEntry({ itemId: "a" }));
      enqueueOfflineMutation(makeEntry({ itemId: "b" }));

      const entries = peekAllEntries();
      expect(entries).toHaveLength(2);

      // Queue should still have entries
      expect(getOfflineQueueSize()).toBe(2);
    });

    it("includes expired entries (raw read)", () => {
      const expired = makeEntry({
        itemId: "old",
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      // Write directly to bypass cleanExpired filter
      store.set(STORAGE_KEY, JSON.stringify([expired]));

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe("old");
    });
  });

  describe("writeAllEntries", () => {
    it("replaces the entire queue", () => {
      enqueueOfflineMutation(makeEntry({ itemId: "a" }));
      enqueueOfflineMutation(makeEntry({ itemId: "b" }));

      writeAllEntries([makeEntry({ itemId: "c" })]);

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe("c");
    });

    it("cleans expired entries before persisting", () => {
      const expired = makeEntry({
        itemId: "old",
        timestamp: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
      });
      const valid = makeEntry({ itemId: "new" });

      writeAllEntries([expired, valid]);

      const entries = peekAllEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.itemId).toBe("new");
    });
  });

  describe("clearOfflineQueue", () => {
    it("removes all entries", () => {
      enqueueOfflineMutation(makeEntry({ itemId: "a" }));
      enqueueOfflineMutation(makeEntry({ itemId: "b" }));

      clearOfflineQueue();

      expect(hasOfflineMutations()).toBe(false);
      expect(peekAllEntries()).toHaveLength(0);
    });
  });

  describe("security: no sensitive data in queue storage", () => {
    it("queue entries contain only metadata (item IDs, timestamps, retry counts)", () => {
      enqueueOfflineMutation(makeEntry());
      enqueueOfflineMutation(makeEntry({ type: "delete" }));

      const raw = store.get(STORAGE_KEY);
      expect(raw).toBeTruthy();

      // Parse the stored JSON
      const stored = JSON.parse(raw!);
      expect(Array.isArray(stored)).toBe(true);

      for (const entry of stored) {
        // Each entry should have only safe metadata fields
        expect(entry).toHaveProperty("type");
        expect(entry).toHaveProperty("itemId");
        expect(entry).toHaveProperty("timestamp");
        expect(entry).toHaveProperty("retryCount");

        // No password, username, origin, keys, or ciphertext
        expect(entry).not.toHaveProperty("password");
        expect(entry).not.toHaveProperty("username");
        expect(entry).not.toHaveProperty("origin");
        expect(entry).not.toHaveProperty("key");
        expect(entry).not.toHaveProperty("ciphertext");
        expect(entry).not.toHaveProperty("encryptedItemKey");
        expect(entry).not.toHaveProperty("encryptedPayload");
        expect(entry).not.toHaveProperty("notes");

        // Type must be upsert or delete only
        expect(["upsert", "delete"]).toContain(entry.type);
      }
    });

    it("stored queue does not contain the word 'password' as a key", () => {
      enqueueOfflineMutation(makeEntry());
      const raw = store.get(STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(raw!).not.toContain('"password"');
    });
  });
});
