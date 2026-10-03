import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { itemLevelSyncPlanSchema, type ItemLevelSyncChange, type VaultItemCiphertext } from "@zero-vault/shared";
import { addCredential, createLocalVaultWithSharedKey, deleteItem, updateItem, unlockLocalVault, persistUnlockedVault, loadEncryptedLocalVault, type UnlockedVault } from "./local-vault";
import { loadPendingItemMutations, loadSyncCursor } from "./sync-vault";

vi.mock("./api-client", () => ({ pullItemLevelSync: vi.fn(), pushItemLevelSync: vi.fn() }));
const { pullItemLevelSync, pushItemLevelSync } = await import("./api-client");
const { performIncrementalSync, handleResolveAcceptRemote, handleResolveKeepLocal } = await import("./vault-sync");
const owner = "30000000-0000-4000-8000-000000000001";
const originalFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    return url.protocol === "file:" ? new Response(await readFile(url), { headers: { "Content-Type": "application/wasm" } }) : originalFetch(input, init);
  };
});
afterAll(() => { globalThis.fetch = originalFetch; vi.unstubAllGlobals(); });

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, String(value)); }
  removeItem(key: string) { this.values.delete(key); }
}

let rows: Map<string, VaultItemCiphertext>;
let revisions: Map<string, number>;
let changes: ItemLevelSyncChange[];
let receipts: Map<string, { plan: string; receipt: { clientMutationId: string; itemId: string; operation: "upsert" | "delete"; appliedItemRevision: number } }>;
let revision: number;
let loseResponse: boolean;

beforeEach(() => {
  rows = new Map(); revisions = new Map(); changes = []; receipts = new Map(); revision = 0; loseResponse = false;
  vi.mocked(pushItemLevelSync).mockImplementation(async (_csrf, raw) => {
    const plan = itemLevelSyncPlanSchema.parse(raw);
    const applied = { upsertedItemIds: [] as string[], deletedItemIds: [] as string[], mutationReceipts: [] as Array<{ clientMutationId: string; itemId: string; operation: "upsert" | "delete"; appliedItemRevision: number }> };
    const conflicts: Array<import("@zero-vault/shared").ItemLevelSyncConflict> = [];
    for (const mutation of [...plan.upserts, ...plan.deletes]) {
      const operation: "delete" | "upsert" = "deletedAt" in mutation ? "delete" : "upsert";
      const previous = receipts.get(mutation.clientMutationId);
      if (previous) {
        expect(JSON.stringify(mutation)).toBe(previous.plan);
        applied.mutationReceipts.push(previous.receipt);
        (operation === "delete" ? applied.deletedItemIds : applied.upsertedItemIds).push(mutation.id);
        continue;
      }
      if ((revisions.get(mutation.id) ?? 0) !== mutation.baseItemRevision) {
        conflicts.push({ itemId: mutation.id, operation, reason: "item_revision_advanced", clientBaseRevision: mutation.baseItemRevision, serverRevision: revision, serverItemRevision: revisions.get(mutation.id)!, serverState: rows.has(mutation.id) ? { kind: "item", item: rows.get(mutation.id)! } : { kind: "deleted", itemId: mutation.id, revision: revisions.get(mutation.id)!, deletedAt: new Date().toISOString() } });
        continue;
      }
      revision += 1;
      revisions.set(mutation.id, revision);
      if ("deletedAt" in mutation) {
        rows.delete(mutation.id);
        changes.push({ cursor: revision, operation: "delete", itemId: mutation.id, revision, deletedAt: mutation.deletedAt });
      } else {
        const { baseItemRevision: _base, clientMutationId: _id, ciphertextHash: _hash, ...item } = mutation;
        const row = { ...item, revision };
        rows.set(mutation.id, row);
        changes.push({ cursor: revision, operation: "upsert", item: row });
      }
      const receipt = { clientMutationId: mutation.clientMutationId, itemId: mutation.id, operation, appliedItemRevision: revision };
      receipts.set(mutation.clientMutationId, { plan: JSON.stringify(mutation), receipt });
      applied.mutationReceipts.push(receipt);
      (operation === "delete" ? applied.deletedItemIds : applied.upsertedItemIds).push(mutation.id);
    }
    if (loseResponse) { loseResponse = false; throw new Error("network_error"); }
    return { protocol: "item_level_v1", serverRevision: revision, applied, conflicts };
  });
  vi.mocked(pullItemLevelSync).mockImplementation(async (cursor) => {
    const page = changes.filter((change) => change.cursor > cursor).slice(0, 1);
    const next = page.at(-1)?.cursor ?? cursor;
    return { protocol: "item_level_v1", serverRevision: revision, cursor: next, hasMore: changes.some((change) => change.cursor > next), changes: page, items: page.flatMap((change) => change.operation === "upsert" ? [change.item] : []), deletedItemIds: page.flatMap((change) => change.operation === "delete" ? [change.itemId] : []), deletedItems: page.flatMap((change) => change.operation === "delete" ? [{ id: change.itemId, revision: change.revision, deletedAt: change.deletedAt }] : []) };
  });
});

async function sync(vault: UnlockedVault, storage: MemoryStorage) {
  vi.stubGlobal("window", { localStorage: storage });
  const result = await performIncrementalSync(vault, owner, "csrf");
  if (result.status !== "item-synced" && result.status !== "conflicts") throw new Error("unexpected result");
  return { result, vault: result.mergedVault!.unlocked };
}

describe("encrypted cross-device synchronization", () => {
  it("uses one shared key with different local passwords, synchronizes edits and deletions, and stays idle when unchanged", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    let a: UnlockedVault = (await createLocalVaultWithSharedKey("first-local-password", key)).unlocked;
    const bCreated = await createLocalVaultWithSharedKey("second-local-password", key);
    let b = await unlockLocalVault("second-local-password", bCreated.encrypted);
    const aStore = new MemoryStorage(); const bStore = new MemoryStorage();
    a = addCredential(a, { title: "Shared", origin: "https://example.com", username: "alice", password: "synthetic-test-only", notes: "" });
    const id = a.snapshot.items[0]!.id;
    a = (await sync(a, aStore)).vault;
    b = (await sync(b, bStore)).vault;
    expect(b.snapshot.items[0]!.title).toBe("Shared");
    b = updateItem(b, id, { ...b.snapshot.items[0]!, title: "Edited on phone" });
    b = (await sync(b, bStore)).vault;
    a = (await sync(a, aStore)).vault;
    expect(a.snapshot.items[0]!.title).toBe("Edited on phone");
    const before = revision;
    await sync(a, aStore);
    expect(revision).toBe(before);
    b = deleteItem(b, id);
    b = (await sync(b, bStore)).vault;
    a = (await sync(a, aStore)).vault;
    expect(a.snapshot.items).toHaveLength(0);
    await sync(a, aStore);
    expect(rows.size).toBe(0);
  });

  it("replays exactly the same ciphertext and mutation after a committed response is lost", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const a = addCredential((await createLocalVaultWithSharedKey("first-local-password", key)).unlocked, { title: "Offline", origin: "https://example.com", username: "test", password: "synthetic-test-only", notes: "" });
    const storage = new MemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    await persistUnlockedVault(a);
    loseResponse = true;
    await expect(performIncrementalSync(a, owner, "csrf")).rejects.toThrow("network_error");
    const queued = loadPendingItemMutations();
    expect(Object.keys(queued)).toHaveLength(1);
    const resumed = await unlockLocalVault("first-local-password", loadEncryptedLocalVault()!);
    await sync(resumed, storage);
    expect(revision).toBe(1);
    expect(loadPendingItemMutations()).toEqual({});
    expect(loadSyncCursor()).toBe(1);
  });

  it("preserves competing edits and allows explicit acceptance of remote data or a remote deletion", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    let a: UnlockedVault = addCredential((await createLocalVaultWithSharedKey("first-local-password", key)).unlocked, { title: "Original", origin: "https://example.com", username: "test", password: "synthetic-test-only", notes: "" });
    let b: UnlockedVault = (await createLocalVaultWithSharedKey("second-local-password", key)).unlocked;
    const aStore = new MemoryStorage(); const bStore = new MemoryStorage();
    const id = a.snapshot.items[0]!.id;
    a = (await sync(a, aStore)).vault;
    b = (await sync(b, bStore)).vault;
    a = updateItem(a, id, { ...a.snapshot.items[0]!, title: "Local edit" });
    b = updateItem(b, id, { ...b.snapshot.items[0]!, title: "Phone edit" });
    b = (await sync(b, bStore)).vault;
    const conflicting = await sync(a, aStore);
    expect(conflicting.result.status).toBe("conflicts");
    expect(conflicting.vault.snapshot.items[0]!.title).toBe("Local edit");
    const accepted = await handleResolveAcceptRemote({ unlockedVault: conflicting.vault, csrfToken: "csrf", itemId: id });
    if (accepted.status !== "ok") throw new Error("accept failed");
    a = accepted.mergedVault.unlocked;
    expect(a.snapshot.items[0]!.title).toBe("Phone edit");
    a = updateItem(a, id, { ...a.snapshot.items[0]!, title: "Keep local" });
    b = deleteItem(b, id);
    await sync(b, bStore);
    const deletedConflict = await sync(a, aStore);
    expect(deletedConflict.result.status).toBe("conflicts");
    expect((await handleResolveKeepLocal({ unlockedVault: a, user: { id: owner }, csrfToken: "csrf", itemId: id })).status).toBe("ok");
    expect(rows.has(id)).toBe(true);
  });
});
