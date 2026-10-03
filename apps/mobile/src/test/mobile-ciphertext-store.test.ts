import { beforeEach, describe, expect, it } from "vitest";
import type { VaultItemCiphertext } from "@zero-vault/shared";
import { InMemoryCiphertextStore } from "../lib/storage/mobile-ciphertext-store";
import {
  CREATED_AT,
  ITEM_ID_A,
  ITEM_ID_B,
  MUTATION_ID_A,
  MUTATION_ID_B,
  UPDATED_AT,
  makeCiphertext,
  makeStoredItem,
} from "./fixtures";

describe("InMemoryCiphertextStore", () => {
  let store: InMemoryCiphertextStore;

  beforeEach(() => {
    store = new InMemoryCiphertextStore();
  });

  it("atomically stores a local ciphertext and its durable upsert mutation", async () => {
    const item = makeStoredItem(ITEM_ID_A, 3);
    await store.enqueueUpsert(item, 3, MUTATION_ID_A);

    expect(await store.getById(ITEM_ID_A)).toEqual(item);
    expect(await store.listPendingMutations()).toEqual([{
      clientMutationId: MUTATION_ID_A,
      itemId: ITEM_ID_A,
      operation: "upsert",
      baseItemRevision: 3,
      ciphertextEnvelopeJson: JSON.stringify(item.ciphertext),
      createdAt: CREATED_AT,
      attemptCount: 0,
      lastErrorCode: null,
    }]);
  });

  it("compacts consecutive edits while preserving the original server base revision", async () => {
    const first = makeStoredItem(ITEM_ID_A, 3);
    const second = {
      ...makeStoredItem(ITEM_ID_A, 3, UPDATED_AT),
      ciphertext: { ...makeCiphertext(ITEM_ID_A, 3), updatedAt: "2026-01-03T00:00:00.000Z" },
    };
    await store.enqueueUpsert(first, 3, MUTATION_ID_A);
    await store.enqueueUpsert(second, 99, MUTATION_ID_B);

    const pending = await store.listPendingMutations();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      clientMutationId: MUTATION_ID_B,
      operation: "upsert",
      baseItemRevision: 3,
      createdAt: CREATED_AT,
    });
    expect(JSON.parse(pending[0]?.ciphertextEnvelopeJson ?? "null")).toEqual(second.ciphertext);
    expect((await store.getById(ITEM_ID_A))?.ciphertext.updatedAt).toBe("2026-01-03T00:00:00.000Z");
  });

  it("coalesces create then delete to no local item and no network mutation", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 0), 0, MUTATION_ID_A);
    await store.enqueueDelete(ITEM_ID_A, 0, MUTATION_ID_B, UPDATED_AT);

    expect(await store.getById(ITEM_ID_A)).toBeNull();
    expect(await store.listPendingMutations()).toEqual([]);
  });

  it("compacts edit then delete using the edit's original base revision", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 8), 8, MUTATION_ID_A);
    await store.enqueueDelete(ITEM_ID_A, 100, MUTATION_ID_B, UPDATED_AT);

    expect(await store.getById(ITEM_ID_A)).toBeNull();
    expect(await store.listPendingMutations()).toEqual([{
      clientMutationId: MUTATION_ID_B,
      itemId: ITEM_ID_A,
      operation: "delete",
      baseItemRevision: 8,
      ciphertextEnvelopeJson: null,
      createdAt: UPDATED_AT,
      attemptCount: 0,
      lastErrorCode: null,
    }]);
  });

  it("acknowledges a mutation by updating both ciphertext revisions before removing the queue row", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 3), 3, MUTATION_ID_A);
    await store.acknowledgeMutations(
      [{ clientMutationId: MUTATION_ID_A, appliedItemRevision: 4 }],
      12,
      UPDATED_AT,
    );

    const stored = await store.getById(ITEM_ID_A);
    expect(stored).toMatchObject({ itemRevision: 4, lastSyncedAt: UPDATED_AT });
    expect(stored?.ciphertext.revision).toBe(4);
    expect(await store.listPendingMutations()).toEqual([]);
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 12,
      serverCursor: 0,
      lastSyncedAt: UPDATED_AT,
    });
  });

  it("rolls back the entire acknowledgement batch when any receipt is invalid", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_B, 2), 2, MUTATION_ID_B);

    await expect(store.acknowledgeMutations([
      { clientMutationId: MUTATION_ID_A, appliedItemRevision: 2 },
      {
        clientMutationId: "99999999-9999-4999-8999-999999999999",
        appliedItemRevision: 3,
      },
    ], 9, UPDATED_AT)).rejects.toThrow("MUTATION_NOT_FOUND");

    expect((await store.getById(ITEM_ID_A))?.itemRevision).toBe(1);
    expect(await store.listPendingMutations()).toHaveLength(2);
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 0,
      serverCursor: 0,
      lastSyncedAt: null,
    });
  });

  it("applies a pull page and cursor atomically while preserving a conflicting local mutation", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.applyPullPage(
      [makeCiphertext(ITEM_ID_A, 2), makeCiphertext(ITEM_ID_B, 5)],
      [],
      14,
      27,
      UPDATED_AT,
    );

    const local = await store.getById(ITEM_ID_A);
    expect(local?.itemRevision).toBe(1);
    expect(local?.hasConflict).toBe(true);
    expect((await store.getById(ITEM_ID_B))?.itemRevision).toBe(5);
    expect(await store.listPendingMutations()).toHaveLength(1);
    expect(await store.listConflicts()).toEqual([
      expect.objectContaining({
        itemId: ITEM_ID_A,
        reason: "item_revision_advanced",
        serverRevision: 14,
        serverItemRevision: 2,
        status: "UNRESOLVED",
      }),
    ]);
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 14,
      serverCursor: 27,
      lastSyncedAt: UPDATED_AT,
    });
  });

  it("rolls back a pull page when any ciphertext fails the strict shared schema", async () => {
    const invalid = {
      ...makeCiphertext(ITEM_ID_B, 2),
      encryptedPayload: {
        alg: "XCHACHA20_POLY1305",
        nonce: "AA",
        ciphertext: "AA",
      },
    } as unknown as VaultItemCiphertext;

    await expect(store.applyPullPage(
      [makeCiphertext(ITEM_ID_A, 1), invalid],
      [],
      2,
      2,
      UPDATED_AT,
    )).rejects.toThrow();

    expect(await store.getAll()).toEqual([]);
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 0,
      serverCursor: 0,
      lastSyncedAt: null,
    });
  });

  it("uses the remote tombstone revision for a pending conflict and deletes independent items", async () => {
    await store.applyPullPage(
      [makeCiphertext(ITEM_ID_A, 1), makeCiphertext(ITEM_ID_B, 1)],
      [],
      1,
      2,
      CREATED_AT,
    );
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.applyPullPage([], [
      { id: ITEM_ID_A, revision: 8, deletedAt: UPDATED_AT },
      { id: ITEM_ID_B, revision: 5, deletedAt: UPDATED_AT },
    ], 2, 4, UPDATED_AT);

    expect(await store.getById(ITEM_ID_A)).not.toBeNull();
    expect(await store.getById(ITEM_ID_B)).toBeNull();
    expect(await store.listConflicts()).toEqual([
      expect.objectContaining({
        itemId: ITEM_ID_A,
        remoteCiphertextEnvelopeJson: null,
        serverRevision: 2,
        serverItemRevision: 8,
      }),
    ]);
  });

  it("clears ciphertexts, queue, conflicts and sync metadata", async () => {
    await store.enqueueUpsert(makeStoredItem(ITEM_ID_A, 1), 1, MUTATION_ID_A);
    await store.applyPullPage([makeCiphertext(ITEM_ID_A, 2)], [], 2, 2, UPDATED_AT);
    await store.clear();

    expect(await store.getAll()).toEqual([]);
    expect(await store.listPendingMutations()).toEqual([]);
    expect(await store.listConflicts()).toEqual([]);
    expect(await store.getSyncMetadata()).toEqual({
      serverRevision: 0,
      serverCursor: 0,
      lastSyncedAt: null,
    });
  });
});
