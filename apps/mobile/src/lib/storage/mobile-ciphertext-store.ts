import {
  vaultItemCiphertextSchema,
  type ItemLevelSyncConflict,
  type ItemLevelSyncPullResponse,
  type VaultItemCiphertext,
} from "@zero-vault/shared";
import type {
  NativeMutationAcknowledgement,
  NativePendingMutation,
  NativeStoredCiphertext,
  NativeSyncConflict,
  NativeSyncMetadata,
} from "@zero-vault/zero-vault-native";

const nativeBridge = () => import("@zero-vault/zero-vault-native");

export interface StoredItem {
  itemId: string;
  ciphertext: VaultItemCiphertext;
  itemRevision: number;
  lastSyncedAt: string;
  hasConflict: boolean;
}

export type PendingMutation = NativePendingMutation;
export type MutationAcknowledgement = NativeMutationAcknowledgement;
export type SyncMetadata = NativeSyncMetadata;
export type StoredSyncConflict = NativeSyncConflict;
export type RemoteDeletedItem = ItemLevelSyncPullResponse["deletedItems"][number];

export interface ConflictPersistenceInput {
  conflict: ItemLevelSyncConflict;
  localCiphertext: VaultItemCiphertext | null;
  createdAt: string;
}

/**
 * Account-partitioned encrypted persistence boundary.
 *
 * Production implementations must make every local write + queue operation,
 * every acknowledgement, and every pull page a single database transaction.
 * Plaintext is deliberately absent from this interface.
 */
export interface MobileCiphertextStore {
  getAll(): Promise<StoredItem[]>;
  getById(itemId: string): Promise<StoredItem | null>;
  getSyncMetadata(): Promise<SyncMetadata>;
  enqueueUpsert(
    item: StoredItem,
    baseItemRevision: number | null,
    clientMutationId: string,
  ): Promise<void>;
  enqueueDelete(
    itemId: string,
    baseItemRevision: number | null,
    clientMutationId: string,
    createdAt: string,
  ): Promise<void>;
  listPendingMutations(): Promise<PendingMutation[]>;
  acknowledgeMutations(
    acknowledgements: MutationAcknowledgement[],
    serverRevision: number,
    timestamp: string,
  ): Promise<void>;
  applyPullPage(
    items: VaultItemCiphertext[],
    deletedItems: RemoteDeletedItem[],
    serverRevision: number,
    cursor: number,
    timestamp: string,
  ): Promise<void>;
  saveConflicts(conflicts: ConflictPersistenceInput[]): Promise<void>;
  listConflicts(): Promise<StoredSyncConflict[]>;
  resolveConflict(
    itemId: string,
    resolution: "keep_local" | "accept_remote" | "create_copy" | "skip",
    replacement?: StoredItem,
    clientMutationId?: string,
  ): Promise<void>;
  clear(): Promise<void>;
}

/** Production store backed by the Kotlin Room repository. */
export class NativeRoomCiphertextStore implements MobileCiphertextStore {
  constructor(private readonly accountId: string) {
    if (!accountId) throw new Error("account_id_required");
  }

  private decode(item: NativeStoredCiphertext): StoredItem {
    const ciphertext = vaultItemCiphertextSchema.parse(JSON.parse(item.ciphertextEnvelopeJson));
    if (ciphertext.id !== item.itemId || ciphertext.revision !== item.itemRevision) {
      throw new Error("native_ciphertext_metadata_mismatch");
    }
    return {
      itemId: item.itemId,
      ciphertext,
      itemRevision: item.itemRevision,
      lastSyncedAt: item.lastSyncedAt,
      hasConflict: item.hasConflict,
    };
  }

  async getAll(): Promise<StoredItem[]> {
    return (await (await nativeBridge()).listCiphertexts(this.accountId)).map((item) => this.decode(item));
  }

  async getById(itemId: string): Promise<StoredItem | null> {
    const item = await (await nativeBridge()).getCiphertext(this.accountId, itemId);
    return item ? this.decode(item) : null;
  }

  async getSyncMetadata(): Promise<SyncMetadata> {
    return (await nativeBridge()).getSyncMetadata(this.accountId);
  }

  async enqueueUpsert(
    item: StoredItem,
    baseItemRevision: number | null,
    clientMutationId: string,
  ): Promise<void> {
    await (await nativeBridge()).upsertLocalCiphertextAndEnqueue(
      this.accountId,
      {
        itemId: item.itemId,
        ciphertextEnvelopeJson: JSON.stringify(item.ciphertext),
        itemRevision: item.itemRevision,
        lastSyncedAt: item.lastSyncedAt,
        hasConflict: false,
      },
      baseItemRevision,
      clientMutationId,
    );
  }

  async enqueueDelete(
    itemId: string,
    baseItemRevision: number | null,
    clientMutationId: string,
    createdAt: string,
  ): Promise<void> {
    await (await nativeBridge()).deleteLocalAndEnqueue(
      this.accountId,
      itemId,
      baseItemRevision,
      clientMutationId,
      createdAt,
    );
  }

  async listPendingMutations(): Promise<PendingMutation[]> {
    return (await nativeBridge()).listPendingMutations(this.accountId);
  }

  async acknowledgeMutations(
    acknowledgements: MutationAcknowledgement[],
    serverRevision: number,
    timestamp: string,
  ): Promise<void> {
    await (await nativeBridge()).ackMutations(
      this.accountId,
      acknowledgements,
      serverRevision,
      timestamp,
    );
  }

  async applyPullPage(
    items: VaultItemCiphertext[],
    deletedItems: RemoteDeletedItem[],
    serverRevision: number,
    cursor: number,
    timestamp: string,
  ): Promise<void> {
    const parsed = items.map((item) => vaultItemCiphertextSchema.parse(item));
    await (await nativeBridge()).applyPullAtomically(
      this.accountId,
      parsed,
      deletedItems,
      serverRevision,
      cursor,
      timestamp,
    );
  }

  async saveConflicts(inputs: ConflictPersistenceInput[]): Promise<void> {
    const conflicts = inputs.map(({ conflict, localCiphertext, createdAt }) => ({
      itemId: conflict.itemId,
      reason: conflict.reason,
      localCiphertextEnvelopeJson: localCiphertext ? JSON.stringify(localCiphertext) : null,
      remoteCiphertextEnvelopeJson:
        conflict.serverState.kind === "item" ? JSON.stringify(conflict.serverState.item) : null,
      serverRevision: conflict.serverRevision,
      serverItemRevision: conflict.serverItemRevision ?? null,
      status: "UNRESOLVED" as const,
      createdAt,
    }));
    await (await nativeBridge()).saveSyncConflicts(this.accountId, conflicts);
  }

  async listConflicts(): Promise<StoredSyncConflict[]> {
    return (await nativeBridge()).listSyncConflicts(this.accountId);
  }

  async resolveConflict(
    itemId: string,
    resolution: "keep_local" | "accept_remote" | "create_copy" | "skip",
    replacement?: StoredItem,
    clientMutationId?: string,
  ): Promise<void> {
    await (await nativeBridge()).resolveSyncConflict(
      this.accountId,
      itemId,
      resolution,
      replacement?.ciphertext ?? null,
      clientMutationId ?? null,
    );
  }

  async clear(): Promise<void> {
    await (await nativeBridge()).clearCiphertexts(this.accountId);
  }
}

/** Deterministic transactional model used by remote unit tests only. */
export class InMemoryCiphertextStore implements MobileCiphertextStore {
  private items = new Map<string, StoredItem>();
  private metadata: SyncMetadata = { serverRevision: 0, lastSyncedAt: null, serverCursor: 0 };
  private pendingByItem = new Map<string, PendingMutation>();
  private conflicts = new Map<string, StoredSyncConflict>();

  async getAll(): Promise<StoredItem[]> {
    return [...this.items.values()].map(cloneStoredItem);
  }

  async getById(itemId: string): Promise<StoredItem | null> {
    const item = this.items.get(itemId);
    return item ? cloneStoredItem(item) : null;
  }

  async getSyncMetadata(): Promise<SyncMetadata> {
    return { ...this.metadata };
  }

  async enqueueUpsert(
    item: StoredItem,
    baseItemRevision: number | null,
    clientMutationId: string,
  ): Promise<void> {
    const prior = this.pendingByItem.get(item.itemId);
    const effectiveBase = prior?.baseItemRevision ?? baseItemRevision ?? 0;
    this.items.set(item.itemId, { ...cloneStoredItem(item), hasConflict: false });
    this.pendingByItem.set(item.itemId, {
      clientMutationId,
      itemId: item.itemId,
      operation: "upsert",
      baseItemRevision: effectiveBase,
      ciphertextEnvelopeJson: JSON.stringify(item.ciphertext),
      createdAt: prior?.createdAt ?? item.lastSyncedAt,
      attemptCount: 0,
      lastErrorCode: null,
    });
  }

  async enqueueDelete(
    itemId: string,
    baseItemRevision: number | null,
    clientMutationId: string,
    createdAt: string,
  ): Promise<void> {
    const prior = this.pendingByItem.get(itemId);
    if (prior?.operation === "upsert" && prior.baseItemRevision === 0) {
      this.pendingByItem.delete(itemId);
      this.items.delete(itemId);
      return;
    }
    const effectiveBase = prior?.baseItemRevision ?? baseItemRevision;
    if (effectiveBase == null) throw new Error("delete_base_revision_required");
    this.pendingByItem.set(itemId, {
      clientMutationId,
      itemId,
      operation: "delete",
      baseItemRevision: effectiveBase,
      ciphertextEnvelopeJson: null,
      createdAt,
      attemptCount: 0,
      lastErrorCode: null,
    });
    this.items.delete(itemId);
  }

  async listPendingMutations(): Promise<PendingMutation[]> {
    return [...this.pendingByItem.values()].map((mutation) => ({ ...mutation }));
  }

  async acknowledgeMutations(
    acknowledgements: MutationAcknowledgement[],
    serverRevision: number,
    timestamp: string,
  ): Promise<void> {
    const nextItems = new Map(
      [...this.items].map(([itemId, item]) => [itemId, cloneStoredItem(item)]),
    );
    const nextPending = new Map(
      [...this.pendingByItem].map(([itemId, mutation]) => [itemId, { ...mutation }]),
    );
    const pendingByMutationId = new Map(
      [...nextPending.values()].map((mutation) => [mutation.clientMutationId, mutation]),
    );
    const seen = new Set<string>();

    for (const acknowledgement of acknowledgements) {
      if (seen.has(acknowledgement.clientMutationId)) throw new Error("DUPLICATE_ACKNOWLEDGEMENT");
      seen.add(acknowledgement.clientMutationId);
      const pending = pendingByMutationId.get(acknowledgement.clientMutationId);
      if (!pending) throw new Error("MUTATION_NOT_FOUND");
      if (pending.operation === "delete") {
        nextItems.delete(pending.itemId);
      } else {
        const stored = nextItems.get(pending.itemId);
        if (!stored) throw new Error("ITEM_NOT_FOUND");
        const ciphertext = {
          ...stored.ciphertext,
          revision: acknowledgement.appliedItemRevision,
        };
        nextItems.set(pending.itemId, {
          ...stored,
          ciphertext,
          itemRevision: acknowledgement.appliedItemRevision,
          lastSyncedAt: timestamp,
          hasConflict: false,
        });
      }
      nextPending.delete(pending.itemId);
    }

    this.items = nextItems;
    this.pendingByItem = nextPending;
    this.metadata = { ...this.metadata, serverRevision, lastSyncedAt: timestamp };
  }

  async applyPullPage(
    items: VaultItemCiphertext[],
    deletedItems: RemoteDeletedItem[],
    serverRevision: number,
    cursor: number,
    timestamp: string,
  ): Promise<void> {
    const parsedItems = items.map((ciphertext) => vaultItemCiphertextSchema.parse(ciphertext));
    const nextItems = new Map(
      [...this.items].map(([itemId, item]) => [itemId, cloneStoredItem(item)]),
    );
    const nextConflicts = new Map(
      [...this.conflicts].map(([itemId, conflict]) => [itemId, { ...conflict }]),
    );

    for (const parsed of parsedItems) {
      if (this.pendingByItem.has(parsed.id)) {
        const local = nextItems.get(parsed.id);
        nextConflicts.set(parsed.id, {
          itemId: parsed.id,
          reason: "item_revision_advanced",
          localCiphertextEnvelopeJson: local ? JSON.stringify(local.ciphertext) : null,
          remoteCiphertextEnvelopeJson: JSON.stringify(parsed),
          serverRevision,
          serverItemRevision: parsed.revision,
          status: "UNRESOLVED",
          createdAt: timestamp,
        });
        if (local) nextItems.set(parsed.id, { ...local, hasConflict: true });
      } else {
        nextItems.set(parsed.id, {
          itemId: parsed.id,
          ciphertext: parsed,
          itemRevision: parsed.revision,
          lastSyncedAt: timestamp,
          hasConflict: false,
        });
      }
    }
    for (const deleted of deletedItems) {
      if (this.pendingByItem.has(deleted.id)) {
        const local = nextItems.get(deleted.id);
        nextConflicts.set(deleted.id, {
          itemId: deleted.id,
          reason: "item_revision_advanced",
          localCiphertextEnvelopeJson: local ? JSON.stringify(local.ciphertext) : null,
          remoteCiphertextEnvelopeJson: null,
          serverRevision,
          serverItemRevision: deleted.revision,
          status: "UNRESOLVED",
          createdAt: timestamp,
        });
        if (local) nextItems.set(deleted.id, { ...local, hasConflict: true });
      } else {
        nextItems.delete(deleted.id);
      }
    }

    this.items = nextItems;
    this.conflicts = nextConflicts;
    this.metadata = { serverRevision, serverCursor: cursor, lastSyncedAt: timestamp };
  }

  async saveConflicts(inputs: ConflictPersistenceInput[]): Promise<void> {
    for (const { conflict, localCiphertext, createdAt } of inputs) {
      this.conflicts.set(conflict.itemId, {
        itemId: conflict.itemId,
        reason: conflict.reason,
        localCiphertextEnvelopeJson: localCiphertext ? JSON.stringify(localCiphertext) : null,
        remoteCiphertextEnvelopeJson:
          conflict.serverState.kind === "item" ? JSON.stringify(conflict.serverState.item) : null,
        serverRevision: conflict.serverRevision,
        serverItemRevision: conflict.serverItemRevision ?? null,
        status: "UNRESOLVED",
        createdAt,
      });
      const item = this.items.get(conflict.itemId);
      if (item) this.items.set(conflict.itemId, { ...item, hasConflict: true });
    }
  }

  async listConflicts(): Promise<StoredSyncConflict[]> {
    return [...this.conflicts.values()].map((conflict) => ({ ...conflict }));
  }

  async resolveConflict(
    itemId: string,
    resolution: "keep_local" | "accept_remote" | "create_copy" | "skip",
    replacement?: StoredItem,
    clientMutationId?: string,
  ): Promise<void> {
    const conflict = this.conflicts.get(itemId);
    if (!conflict) throw new Error("CONFLICT_NOT_FOUND");
    if (resolution === "skip") {
      this.conflicts.set(itemId, { ...conflict, status: "SKIPPED" });
      return;
    }
    const applyRemote = () => {
      if (conflict.remoteCiphertextEnvelopeJson) {
        const ciphertext = vaultItemCiphertextSchema.parse(
          JSON.parse(conflict.remoteCiphertextEnvelopeJson),
        );
        this.items.set(itemId, {
          itemId,
          ciphertext,
          itemRevision: ciphertext.revision,
          lastSyncedAt: new Date().toISOString(),
          hasConflict: false,
        });
      } else {
        this.items.delete(itemId);
      }
      this.pendingByItem.delete(itemId);
    };
    if (resolution === "accept_remote") {
      applyRemote();
    } else if (resolution === "keep_local") {
      const pending = this.pendingByItem.get(itemId);
      const local = this.items.get(itemId);
      this.pendingByItem.delete(itemId);
      if (pending?.operation === "delete") {
        await this.enqueueDelete(
          itemId,
          conflict.serverItemRevision ?? 0,
          crypto.randomUUID(),
          new Date().toISOString(),
        );
      } else {
        if (!local) throw new Error("ITEM_NOT_FOUND");
        await this.enqueueUpsert(local, conflict.serverItemRevision ?? 0, crypto.randomUUID());
      }
    } else {
      if (!replacement || !clientMutationId) throw new Error("replacement_required");
      applyRemote();
      await this.enqueueUpsert(replacement, 0, clientMutationId);
    }
    this.conflicts.delete(itemId);
    const item = this.items.get(itemId);
    if (item) this.items.set(itemId, { ...item, hasConflict: false });
  }

  async clear(): Promise<void> {
    this.items.clear();
    this.pendingByItem.clear();
    this.conflicts.clear();
    this.metadata = { serverRevision: 0, lastSyncedAt: null, serverCursor: 0 };
  }
}

function cloneStoredItem(item: StoredItem): StoredItem {
  return {
    ...item,
    ciphertext: structuredClone(item.ciphertext),
  };
}
