import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryCiphertextStore,
  type DesktopCiphertextStore,
  type StoredItem,
} from "../lib/storage/desktop-ciphertext-store";
import type { VaultItemCiphertext } from "@zero-vault/shared";

// ── Fixtures ────────────────────────────────────────────────────────────────

function makeCiphertext(id: string): VaultItemCiphertext {
  return {
    id,
    ownerUserId: "550e8400-e29b-41d4-a716-446655440000",
    revision: 1,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    encryptedItemKey: {
      alg: "XCHACHA20_POLY1305",
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ciphertext: "dGVzdA",
    },
    encryptedPayload: {
      alg: "XCHACHA20_POLY1305",
      nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ciphertext: "dGVzdA",
    },
    encryptedSearchTokens: [],
  };
}

function makeStoredItem(id: string, overrides?: Partial<StoredItem>): StoredItem {
  return {
    itemId: id,
    ciphertext: makeCiphertext(id),
    itemRevision: 1,
    lastSyncedAt: "2025-01-01T00:00:00Z",
    hasConflict: false,
    ...overrides,
  };
}

const ITEM_A_ID = "550e8400-e29b-41d4-a716-446655440001";
const ITEM_B_ID = "550e8400-e29b-41d4-a716-446655440002";
const ITEM_C_ID = "550e8400-e29b-41d4-a716-446655440003";

// ── InMemoryCiphertextStore tests ───────────────────────────────────────────

describe("InMemoryCiphertextStore", () => {
  let store: DesktopCiphertextStore;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
  });

  // ── CRUD ─────────────────────────────────────────────────────────────────

  describe("getAll", () => {
    it("returns empty array when no items exist", async () => {
      expect(await store.getAll()).toEqual([]);
    });

    it("returns all stored items", async () => {
      await store.upsert(makeStoredItem(ITEM_A_ID));
      await store.upsert(makeStoredItem(ITEM_B_ID));

      const all = await store.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((i) => i.itemId).sort()).toEqual([ITEM_A_ID, ITEM_B_ID].sort());
    });
  });

  describe("getById", () => {
    it("returns null for non-existent item", async () => {
      expect(await store.getById(ITEM_A_ID)).toBeNull();
    });

    it("returns the stored item", async () => {
      const item = makeStoredItem(ITEM_A_ID);
      await store.upsert(item);

      const result = await store.getById(ITEM_A_ID);
      expect(result).toEqual(item);
    });
  });

  describe("upsert", () => {
    it("inserts a new item", async () => {
      const item = makeStoredItem(ITEM_A_ID);
      await store.upsert(item);

      expect(await store.getById(ITEM_A_ID)).toEqual(item);
    });

    it("overwrites an existing item", async () => {
      await store.upsert(makeStoredItem(ITEM_A_ID, { itemRevision: 1 }));
      await store.upsert(makeStoredItem(ITEM_A_ID, { itemRevision: 2 }));

      const result = await store.getById(ITEM_A_ID);
      expect(result?.itemRevision).toBe(2);
    });
  });

  describe("delete", () => {
    it("removes an item", async () => {
      await store.upsert(makeStoredItem(ITEM_A_ID));
      await store.delete(ITEM_A_ID);

      expect(await store.getById(ITEM_A_ID)).toBeNull();
    });

    it("is a no-op for non-existent item", async () => {
      await store.delete(ITEM_A_ID); // should not throw
      expect(await store.getAll()).toEqual([]);
    });
  });

  // ── Server revision ──────────────────────────────────────────────────────

  describe("server revision", () => {
    it("defaults to 0", async () => {
      expect(await store.getServerRevision()).toBe(0);
    });

    it("persists the revision", async () => {
      await store.setServerRevision(42);
      expect(await store.getServerRevision()).toBe(42);
    });

    it("overwrites the revision", async () => {
      await store.setServerRevision(42);
      await store.setServerRevision(100);
      expect(await store.getServerRevision()).toBe(100);
    });
  });

  // ── Last synced at ───────────────────────────────────────────────────────

  describe("lastSyncedAt", () => {
    it("defaults to null", async () => {
      expect(await store.getLastSyncedAt()).toBeNull();
    });

    it("persists the timestamp", async () => {
      await store.setLastSyncedAt("2025-06-01T12:00:00Z");
      expect(await store.getLastSyncedAt()).toBe("2025-06-01T12:00:00Z");
    });

    it("overwrites the timestamp", async () => {
      await store.setLastSyncedAt("2025-06-01T12:00:00Z");
      await store.setLastSyncedAt("2025-07-01T12:00:00Z");
      expect(await store.getLastSyncedAt()).toBe("2025-07-01T12:00:00Z");
    });
  });

  // ── Conflict IDs ─────────────────────────────────────────────────────────

  describe("conflict IDs", () => {
    it("defaults to empty set", async () => {
      const ids = await store.getConflictIds();
      expect(ids.size).toBe(0);
    });

    it("persists conflict IDs", async () => {
      await store.setConflictIds(new Set([ITEM_A_ID, ITEM_B_ID]));

      const ids = await store.getConflictIds();
      expect(ids.size).toBe(2);
      expect(ids.has(ITEM_A_ID)).toBe(true);
      expect(ids.has(ITEM_B_ID)).toBe(true);
    });

    it("returns a copy, not a reference", async () => {
      await store.setConflictIds(new Set([ITEM_A_ID]));
      const ids = await store.getConflictIds();
      ids.add(ITEM_B_ID);

      // Original store should not be affected.
      const ids2 = await store.getConflictIds();
      expect(ids2.size).toBe(1);
    });

    it("overwrites the set", async () => {
      await store.setConflictIds(new Set([ITEM_A_ID, ITEM_B_ID]));
      await store.setConflictIds(new Set([ITEM_C_ID]));

      const ids = await store.getConflictIds();
      expect(ids.size).toBe(1);
      expect(ids.has(ITEM_C_ID)).toBe(true);
    });
  });

  // ── Clear ────────────────────────────────────────────────────────────────

  describe("clear", () => {
    it("empties items, resets metadata, clears conflicts", async () => {
      await store.upsert(makeStoredItem(ITEM_A_ID));
      await store.upsert(makeStoredItem(ITEM_B_ID));
      await store.setServerRevision(50);
      await store.setLastSyncedAt("2025-01-01T00:00:00Z");
      await store.setConflictIds(new Set([ITEM_A_ID]));

      await store.clear();

      expect(await store.getAll()).toEqual([]);
      expect(await store.getServerRevision()).toBe(0);
      expect(await store.getLastSyncedAt()).toBeNull();
      expect((await store.getConflictIds()).size).toBe(0);
    });
  });
});
