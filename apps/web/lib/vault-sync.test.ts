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
  mergeRemoteItems: vi.fn(async (vault) => ({ vault, revisionMap: {} })),
  performItemLevelSync: vi.fn(),
}));

vi.mock("./item-sync", () => ({
  buildItemLevelSyncPlan: vi.fn(async () => ({
    plan: { protocol: "item_level_v1", baseRevision: 0, upserts: [], deletes: [] },
    itemInfos: [],
  })),
  extractConflicts: vi.fn((response) => response.conflicts ?? []),
}));

const { performSync } = await import("./vault-sync");
const { pullVault, pushVault, pushItemLevelSync } = await import("./api-client");
const { mergeRemoteItems, performItemLevelSync } = await import("./sync-vault");

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
      expect(result.serverRevision).toBe(2);
      expect(result.appliedCount).toBe(1);
    }
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
});
