import { describe, it, expect, vi, beforeEach } from "vitest";
import type { EncryptedLocalVault, UnlockedVault } from "./local-vault";

// Mock dependencies
vi.mock("./api-client", () => ({
  pullVault: vi.fn(),
  pushItemLevelSync: vi.fn(),
  pushVault: vi.fn(),
}));

vi.mock("./sync-vault", () => ({
  loadLocalServerRevision: vi.fn(() => 0),
  saveLocalServerRevision: vi.fn(),
  loadItemRevisionMap: vi.fn(() => ({})),
  saveItemRevisionMap: vi.fn(),
  loadConflictIds: vi.fn(() => new Set()),
  saveConflictIds: vi.fn(),
  loadLastSyncedAt: vi.fn(() => null),
  saveLastSyncedAt: vi.fn(),
  encryptedVaultToSyncRequest: vi.fn((ev, uid, rev) => ({ baseRevision: rev, upserts: [], deletes: [] })),
  getSyncedLocalVaultItem: vi.fn(() => null),
  syncItemToEncryptedVault: vi.fn(),
  mergeRemoteItems: vi.fn(async (vault) => ({ vault, revisionMap: {}, mergedItemIds: [], failedItemIds: [] })),
  performItemLevelSync: vi.fn(),
}));

vi.mock("./item-sync", () => ({
  buildItemLevelSyncPlan: vi.fn(async () => ({
    plan: { protocol: "item_level_v1", baseRevision: 0, upserts: [], deletes: [] },
    itemInfos: [],
  })),
  extractConflicts: vi.fn((response) => response.conflicts ?? []),
}));

const { performSync, handleResolveKeepLocal } = await import("./vault-sync");
const { pullVault, pushVault, pushItemLevelSync } = await import("./api-client");
const { mergeRemoteItems, performItemLevelSync, encryptedVaultToSyncRequest, saveLocalServerRevision, loadItemRevisionMap, loadLocalServerRevision } = await import("./sync-vault");
const { buildItemLevelSyncPlan } = await import("./item-sync");

const mockEncryptedVault = {
  schemaVersion: 1,
  kdf: { alg: "ARGON2ID_V13", memoryKib: 19456, iterations: 2, parallelism: 1, salt: "abc" },
  cipher: { alg: "XCHACHA20_POLY1305", nonce: "def" },
  ciphertext: "encrypted",
  itemCount: 1,
  updatedAt: new Date().toISOString(),
} as unknown as EncryptedLocalVault;

const mockUnlockedVault = {
  runtime: "crypto-core-wasm",
  key: new Uint8Array(32),
  kdf: { alg: "ARGON2ID_V13", memoryKib: 19456, iterations: 2, parallelism: 1, salt: "" },
  snapshot: {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [],
  },
} as unknown as UnlockedVault;

describe("performSync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns no-local-vault when encryptedVault is null", async () => {
    const result = await performSync({
      encryptedVault: null,
      unlockedVault: null,
      user: { id: "user-1", serverRevision: 0 },
      csrfToken: "token",
    });
    expect(result.status).toBe("no-local-vault");
  });

  it("returns not-logged-in when user is missing", async () => {
    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: null,
      user: null as unknown as { id: string; serverRevision: number },
      csrfToken: "",
    });
    expect(result.status).toBe("not-logged-in");
  });

  it("returns item-synced on successful item-level sync", async () => {
    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [],
      deletedItemIds: [],
    });
    vi.mocked(pushVault).mockResolvedValue({ serverRevision: 3 });
    vi.mocked(performItemLevelSync).mockResolvedValue({
      protocol: "item_level_v1",
      response: {
        protocol: "item_level_v1",
        serverRevision: 2,
        applied: { upsertedItemIds: ["item-1"], deletedItemIds: [] },
        conflicts: [],
      },
      mergedVault: mockUnlockedVault,
      itemInfos: [{ itemId: "item-1", status: "synced", revision: 2 }],
      hasConflicts: false,
    });

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 1 },
      csrfToken: "token",
    });
    expect(result.status).toBe("item-synced");
    if (result.status === "item-synced") {
      expect(result.serverRevision).toBe(3);
      expect(result.appliedCount).toBe(1);
    }
    expect(encryptedVaultToSyncRequest).toHaveBeenCalledWith(mockEncryptedVault, "user-1", 2);
    expect(pushVault).toHaveBeenCalledTimes(1);
  });

  it("returns remote-vault-mismatch when pulled items cannot be decrypted", async () => {
    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [{
        id: "10000000-0000-4000-8000-000000000001",
        ownerUserId: "user-1",
        revision: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "n", ciphertext: "c" },
        encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "n", ciphertext: "c" },
        encryptedSearchTokens: [],
      }],
      deletedItemIds: [],
    });
    vi.mocked(mergeRemoteItems).mockResolvedValue({
      vault: mockUnlockedVault,
      revisionMap: {},
      mergedItemIds: [],
      failedItemIds: ["10000000-0000-4000-8000-000000000001"],
    });

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 1 },
      csrfToken: "token",
    });

    expect(result.status).toBe("remote-vault-mismatch");
    if (result.status === "remote-vault-mismatch") {
      expect(result.failedItemCount).toBe(1);
      expect(result.canRestoreFromCloud).toBe(false);
    }
    expect(performItemLevelSync).not.toHaveBeenCalled();
    expect(pushVault).not.toHaveBeenCalled();
  });

  it("returns conflicts when item-level sync has conflicts", async () => {
    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [],
      deletedItemIds: [],
    });
    vi.mocked(performItemLevelSync).mockResolvedValue({
      protocol: "item_level_v1",
      response: {
        protocol: "item_level_v1",
        serverRevision: 2,
        applied: { upsertedItemIds: [], deletedItemIds: [] },
        conflicts: [{
          itemId: "item-1",
          operation: "upsert",
          reason: "item_revision_advanced",
          clientBaseRevision: 1,
          serverRevision: 2,
          serverItemRevision: 3,
        }],
      },
      mergedVault: mockUnlockedVault,
      itemInfos: [{ itemId: "item-1", status: "conflict", revision: undefined }],
      hasConflicts: true,
    });

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 1 },
      csrfToken: "token",
    });
    expect(result.status).toBe("conflicts");
    if (result.status === "conflicts") {
      expect(result.conflicts).toHaveLength(1);
    }
  });

  it("returns version-conflict when remote revision differs from local", async () => {
    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 5,
      items: [],
      deletedItemIds: [],
    });
    vi.mocked(performItemLevelSync).mockRejectedValue(new Error("not supported"));

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: null,
      user: { id: "user-1", serverRevision: 0 },
      csrfToken: "token",
    });
    expect(result.status).toBe("version-conflict");
  });

  it("returns error on sync_conflict", async () => {
    vi.mocked(pullVault).mockRejectedValue(new Error("sync_conflict"));

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 0 },
      csrfToken: "token",
    });
    expect(result.status).toBe("sync-conflict");
  });

  it("returns error on network failure", async () => {
    vi.mocked(pullVault).mockRejectedValue(new Error("network_error"));

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 0 },
      csrfToken: "token",
    });
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toBe("network_error");
    }
  });

  it("resolves keep-local conflicts using the latest remote revision", async () => {
    const itemId = "10000000-0000-4000-8000-000000000002";
    const localItem = {
      id: itemId,
      type: "login",
      title: "Local wins",
      origin: "https://local.example.com",
      username: "local",
      password: "secret",
      notes: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const vaultWithItem = {
      ...mockUnlockedVault,
      snapshot: {
        ...mockUnlockedVault.snapshot,
        items: [localItem],
      },
    } as unknown as UnlockedVault;

    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 9,
      items: [{
        id: itemId,
        ownerUserId: "user-1",
        revision: 8,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-03T00:00:00.000Z",
        encryptedItemKey: { alg: "XCHACHA20_POLY1305", nonce: "n", ciphertext: "c" },
        encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce: "n", ciphertext: "c" },
        encryptedSearchTokens: [],
      }],
      deletedItemIds: [],
    });
    vi.mocked(pushItemLevelSync).mockResolvedValue({
      protocol: "item_level_v1",
      serverRevision: 10,
      applied: { upsertedItemIds: [itemId], deletedItemIds: [] },
      conflicts: [],
    });

    const result = await handleResolveKeepLocal({
      unlockedVault: vaultWithItem,
      user: { id: "user-1" },
      csrfToken: "csrf-1",
      itemId,
    });

    expect(result.status).toBe("ok");
    expect(buildItemLevelSyncPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ items: [localItem] }),
      }),
      "user-1",
      { [itemId]: 8 },
      new Set(),
      9,
    );
    expect(saveLocalServerRevision).toHaveBeenCalledWith(10);
  });

  it("succeeds with item-sync revision when legacy pushVault fails", async () => {
    vi.mocked(pullVault).mockResolvedValue({
      serverRevision: 1,
      items: [],
      deletedItemIds: [],
    });
    vi.mocked(performItemLevelSync).mockResolvedValue({
      protocol: "item_level_v1",
      response: {
        protocol: "item_level_v1",
        serverRevision: 5,
        applied: { upsertedItemIds: ["item-1"], deletedItemIds: [] },
        conflicts: [],
      },
      mergedVault: mockUnlockedVault,
      itemInfos: [{ itemId: "item-1", status: "synced", revision: 5 }],
      hasConflicts: false,
    });
    vi.mocked(pushVault).mockRejectedValue(new Error("network_error"));

    const result = await performSync({
      encryptedVault: mockEncryptedVault,
      unlockedVault: mockUnlockedVault,
      user: { id: "user-1", serverRevision: 1 },
      csrfToken: "token",
    });

    expect(result.status).toBe("item-synced");
    if (result.status === "item-synced") {
      expect(result.serverRevision).toBe(5);
      expect(result.appliedCount).toBe(1);
    }
    expect(saveLocalServerRevision).toHaveBeenCalledWith(5);
  });

  it("falls back to local revision data when pullVault fails during keep-local resolve", async () => {
    const itemId = "10000000-0000-4000-8000-000000000003";
    const localItem = {
      id: itemId,
      type: "login",
      title: "Offline item",
      origin: "https://offline.example.com",
      username: "user",
      password: "pass",
      notes: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const vaultWithItem = {
      ...mockUnlockedVault,
      snapshot: {
        ...mockUnlockedVault.snapshot,
        items: [localItem],
      },
    } as unknown as UnlockedVault;

    vi.mocked(pullVault).mockRejectedValue(new Error("network_error"));
    vi.mocked(loadItemRevisionMap).mockReturnValue({ [itemId]: 7 });
    vi.mocked(loadLocalServerRevision).mockReturnValue(12);
    vi.mocked(pushItemLevelSync).mockResolvedValue({
      protocol: "item_level_v1",
      serverRevision: 13,
      applied: { upsertedItemIds: [itemId], deletedItemIds: [] },
      conflicts: [],
    });

    const result = await handleResolveKeepLocal({
      unlockedVault: vaultWithItem,
      user: { id: "user-1" },
      csrfToken: "csrf-1",
      itemId,
    });

    expect(result.status).toBe("ok");
    expect(buildItemLevelSyncPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({ items: [localItem] }),
      }),
      "user-1",
      { [itemId]: 7 },
      new Set(),
      12,
    );
    expect(saveLocalServerRevision).toHaveBeenCalledWith(13);
  });
});
