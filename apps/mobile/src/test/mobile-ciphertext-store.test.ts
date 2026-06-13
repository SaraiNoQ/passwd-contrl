import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryCiphertextStore } from "../lib/storage/mobile-ciphertext-store";
import type { VaultItemCiphertext } from "@zero-vault/shared";

describe("InMemoryCiphertextStore", () => {
  let store: InMemoryCiphertextStore;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
  });

  const makeItem = (id: string, revision: number): VaultItemCiphertext => ({
    id,
    ownerUserId: "user-1",
    revision,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
    encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "AA", ciphertext: "AA" },
    encryptedSearchTokens: [],
  });

  it("should store and retrieve items", async () => {
    const item = makeItem("item-1", 1);
    await store.upsert({
      itemId: "item-1",
      ciphertext: item,
      itemRevision: 1,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });

    const retrieved = await store.getById("item-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.itemId).toBe("item-1");
  });

  it("should return all items", async () => {
    await store.upsert({
      itemId: "item-1",
      ciphertext: makeItem("item-1", 1),
      itemRevision: 1,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });
    await store.upsert({
      itemId: "item-2",
      ciphertext: makeItem("item-2", 2),
      itemRevision: 2,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });

    const all = await store.getAll();
    expect(all.length).toBe(2);
  });

  it("should delete items", async () => {
    await store.upsert({
      itemId: "item-1",
      ciphertext: makeItem("item-1", 1),
      itemRevision: 1,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });
    await store.delete("item-1");
    const retrieved = await store.getById("item-1");
    expect(retrieved).toBeNull();
  });

  it("should return null for unknown items", async () => {
    const retrieved = await store.getById("nonexistent");
    expect(retrieved).toBeNull();
  });

  it("should track server revision", async () => {
    await store.setServerRevision(42);
    const rev = await store.getServerRevision();
    expect(rev).toBe(42);
  });

  it("should track last synced at", async () => {
    await store.setLastSyncedAt("2026-06-01T12:00:00Z");
    const ts = await store.getLastSyncedAt();
    expect(ts).toBe("2026-06-01T12:00:00Z");
  });

  it("should track conflict IDs", async () => {
    const ids = new Set(["c1", "c2"]);
    await store.setConflictIds(ids);
    const retrieved = await store.getConflictIds();
    expect(retrieved.size).toBe(2);
    expect(retrieved.has("c1")).toBe(true);
  });

  it("should clear all data", async () => {
    await store.upsert({
      itemId: "item-1",
      ciphertext: makeItem("item-1", 1),
      itemRevision: 1,
      lastSyncedAt: "2026-01-01T00:00:00Z",
      hasConflict: false,
    });
    await store.setServerRevision(42);
    await store.clear();

    const all = await store.getAll();
    expect(all.length).toBe(0);
    const rev = await store.getServerRevision();
    expect(rev).toBe(0);
    const ts = await store.getLastSyncedAt();
    expect(ts).toBeNull();
  });
});
