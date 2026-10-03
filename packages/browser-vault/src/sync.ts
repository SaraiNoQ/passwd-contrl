import { itemLevelSyncPullResponseSchema, itemLevelSyncResponseSchema, type ItemLevelSyncPlan } from '@zero-vault/shared';
import { buildItemLevelSyncPlan, type PendingItemMutation } from './item-sync';
import { decryptItemFromSync, type UnlockedVault } from './local-vault';

export type SyncState = {
  cursor: number; serverRevision: number; revisions: Record<string, number>;
  timestamps: Record<string, string>; pending: Record<string, PendingItemMutation>; conflicts: string[];
};
export const emptySyncState = (): SyncState => ({ cursor: 0, serverRevision: 0, revisions: {}, timestamps: {}, pending: {}, conflicts: [] });
export type SyncIO = {
  push(plan: ItemLevelSyncPlan): Promise<unknown>;
  pull(cursor: number): Promise<unknown>;
  // Commit the encrypted snapshot before its cursor, or atomically with it.
  commit(state: SyncState, vault?: UnlockedVault): Promise<void>;
};

export async function syncVault(vault: UnlockedVault, userId: string, initial: SyncState, io: SyncIO) {
  const state = structuredClone(initial);
  let active = vault;
  let appliedCount = 0;
  const conflictDetails: Array<{ itemId: string; reason: string; localRevision: number | undefined; serverRevision: number | undefined }> = [];
  for (;;) {
    const built = await buildItemLevelSyncPlan(active, userId, state.revisions, new Set(state.conflicts), state.serverRevision, state.pending, state.timestamps);
    state.pending = built.pendingMutations;
    await io.commit(state);
    if (!built.plan.upserts.length && !built.plan.deletes.length) break;
    const response = itemLevelSyncResponseSchema.parse(await io.push(built.plan));
    const receipts = response.applied.mutationReceipts;
    if (!receipts || response.serverRevision < state.serverRevision) throw new Error('sync_receipt_invalid');
    const operations = new Map<string, { item: { id: string; baseItemRevision: number; clientMutationId: string }; operation: 'upsert' | 'delete' }>([
      ...built.plan.upserts.map(item => [item.clientMutationId, { item, operation: 'upsert' as const }] as const),
      ...built.plan.deletes.map(item => [item.clientMutationId, { item, operation: 'delete' as const }] as const)
    ]);
    const seen = new Set<string>();
    for (const receipt of receipts) {
      const submitted = operations.get(receipt.clientMutationId);
      if (!submitted || seen.has(receipt.clientMutationId) || submitted.item.id !== receipt.itemId || submitted.operation !== receipt.operation || receipt.appliedItemRevision <= submitted.item.baseItemRevision || receipt.appliedItemRevision > response.serverRevision) throw new Error('sync_receipt_invalid');
      seen.add(receipt.clientMutationId);
    }
    const conflicting = new Set<string>();
    for (const conflict of response.conflicts) {
      const submitted = [...operations.values()].find(({ item }) => item.id === conflict.itemId);
      if (!submitted || conflicting.has(conflict.itemId) || submitted.operation !== conflict.operation || submitted.item.baseItemRevision !== conflict.clientBaseRevision || seen.has(submitted.item.clientMutationId)) throw new Error('sync_conflict_invalid');
      conflicting.add(conflict.itemId);
    }
    if (receipts.length + response.conflicts.length !== operations.size) throw new Error('sync_receipt_missing');
    for (const receipt of receipts) {
      if (receipt.operation === 'delete') { delete state.revisions[receipt.itemId]; delete state.timestamps[receipt.itemId]; }
      else { state.revisions[receipt.itemId] = receipt.appliedItemRevision; state.timestamps[receipt.itemId] = state.pending[receipt.itemId]!.itemUpdatedAt; }
      delete state.pending[receipt.itemId];
    }
    state.serverRevision = response.serverRevision;
    appliedCount += receipts.length;
    for (const conflict of response.conflicts) {
      if (!state.conflicts.includes(conflict.itemId)) state.conflicts.push(conflict.itemId);
      conflictDetails.push({ itemId: conflict.itemId, reason: conflict.reason, localRevision: conflict.clientBaseRevision, serverRevision: conflict.serverItemRevision });
    }
    await io.commit(state);
  }
  for (let page = 0; page < 1000; page++) {
    const remote = itemLevelSyncPullResponseSchema.parse(await io.pull(state.cursor));
    if (remote.cursor < state.cursor || remote.serverRevision < state.serverRevision || (remote.hasMore && remote.cursor <= state.cursor)) throw new Error('sync_cursor_invalid');
    const items = new Map(active.snapshot.items.map(item => [item.id, item]));
    for (const change of remote.changes) {
      const id = change.operation === 'upsert' ? change.item.id : change.itemId;
      if (id === '00000000-0000-4000-8000-000000000001' || state.pending[id] || state.conflicts.includes(id)) continue;
      if (change.operation === 'delete') {
        if ((state.revisions[id] ?? -1) > change.revision) continue;
        items.delete(id); delete state.revisions[id]; delete state.timestamps[id];
      } else {
        if (change.item.ownerUserId !== userId) throw new Error('item_owner_mismatch');
        if ((state.revisions[id] ?? -1) > change.item.revision) continue;
        const item = await decryptItemFromSync(active, change.item.encryptedItemKey, change.item.encryptedPayload, id);
        items.set(id, item); state.revisions[id] = change.item.revision; state.timestamps[id] = item.updatedAt;
      }
    }
    active = { ...active, snapshot: { ...active.snapshot, items: [...items.values()] } };
    state.serverRevision = remote.serverRevision; state.cursor = remote.cursor;
    await io.commit(state, active);
    if (!remote.hasMore) break;
    if (page === 999) throw new Error('sync_page_limit');
  }
  for (const id of state.conflicts) if (!conflictDetails.some(c => c.itemId === id)) conflictDetails.push({ itemId: id, reason: 'unresolved', localRevision: state.revisions[id], serverRevision: undefined });
  return { vault: active, state, conflicts: conflictDetails, appliedCount };
}
