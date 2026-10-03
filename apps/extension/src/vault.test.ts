import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';
import { installBrowserMock, local, session } from './test-browser';
import { toBase64Url, encodeText } from '@zero-vault/browser-vault/crypto-utils';
import { createDeviceVaultKeyPacket } from '@zero-vault/browser-vault/device-packet';
import { encryptItemForSync } from '@zero-vault/browser-vault/local-vault';
import { type VaultItemCiphertext, type ItemLevelSyncPlan } from '@zero-vault/shared';
beforeEach(() => { vi.resetModules(); installBrowserMock(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => vi.unstubAllGlobals());
it('encrypts persistent identity, survives lock/unlock and preserves offline changes', async () => {
  const wasmUrl = pathToFileURL(path.resolve('../../packages/crypto-core-wasm/pkg/crypto_core_bg.wasm'));
  chrome.runtime.getURL = () => wasmUrl.href;
  let packet: unknown;
  let offline = false;
  let revision = 0;
  const rows = new Map<string, VaultItemCiphertext>();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    if (url.protocol === 'file:') return new Response(await readFile(decodeURIComponent(url.pathname)), { headers: { 'Content-Type': 'application/wasm' } });
    if (offline) throw new TypeError('offline');
    if (url.pathname === '/devices/self') return Response.json({ device: { id: identity.device.id, status: 'approved' } });
    if (url.pathname.endsWith('/key')) return Response.json({ encryptedVaultKeyPacket: packet });
    if (init?.method === 'POST') {
      const plan = JSON.parse(init.body as string) as ItemLevelSyncPlan;
      const receipts = plan.upserts.map(upsert => {
        expect(upsert.baseItemRevision).toBe(rows.get(upsert.id)?.revision ?? 0);
        const { baseItemRevision: _base, clientMutationId: _mutation, ...item } = upsert;
        rows.set(upsert.id, { ...item, revision: ++revision });
        return { clientMutationId: upsert.clientMutationId, itemId: upsert.id, operation: 'upsert', appliedItemRevision: revision };
      });
      return Response.json({ protocol: 'item_level_v1', serverRevision: revision, applied: { upsertedItemIds: plan.upserts.map(item => item.id), deletedItemIds: [], mutationReceipts: receipts }, conflicts: [] });
    }
    return Response.json({ protocol: 'item_level_v1', serverRevision: revision, cursor: revision, hasMore: false, changes: [...rows.values()].map(item => ({ cursor: item.revision, operation: 'upsert', item })), items: [...rows.values()], deletedItemIds: [], deletedItems: [] });
  }));
  const vault = await import('./vault');
  const core = await vault.core(); const pair = core.generateDeviceKeypair(); const sharedKey = crypto.getRandomValues(new Uint8Array(32));
  const identity = { user: { id: crypto.randomUUID(), email: 'fixture@example.test' }, device: { id: crypto.randomUUID(), publicKey: toBase64Url(pair.slice(32)), privateKey: toBase64Url(pair.slice(0, 32)), credential: toBase64Url(crypto.getRandomValues(new Uint8Array(32))), fingerprint: 'synthetic-fingerprint' }, sessionToken: 'A'.repeat(43), csrfToken: 'synthetic-csrf' };
  packet = createDeviceVaultKeyPacket(identity.device.id, identity.device.publicKey, toBase64Url(core.encryptForDevice(pair.slice(32), sharedKey)));
  session.deviceSetup = { identity, status: 'approved' };
  const password = 'synthetic-local-password-123';
  await vault.finishConnect(password);
  expect(JSON.stringify(local)).not.toContain(identity.device.privateKey);
  expect(JSON.stringify(local)).not.toContain(identity.device.credential);
  expect(JSON.stringify(local)).not.toContain(identity.sessionToken);
  expect(JSON.stringify(local)).not.toContain(password);
  offline = true;
  await vault.saveLogin('https://example.test', 'fixture', 'synthetic-login-secret');
  expect(JSON.stringify(local)).not.toContain('synthetic-login-secret');
  await vault.lock(); expect(await vault.access()).toBeNull();
  await expect(vault.unlock('incorrect-password')).rejects.toThrow();
  await vault.unlock(password);
  expect(await vault.withVault(async ({ vault }) => vault.snapshot.items.filter(i => i.type === 'login').map(i => i.type === 'login' ? i.password : ''))).toEqual(['synthetic-login-secret']);
  const initialDisk = structuredClone(local.encryptedVault) as { sync: { conflicts: string[]; serverRevision: number } };
  const remote = await vault.withVault(async ({ vault: unlocked }) => {
    const item = unlocked.snapshot.items[0]!;
    if (item.type !== 'login') throw new Error('wrong_fixture_type');
    const changed = { ...item, password: 'synthetic-remote-secret', updatedAt: new Date().toISOString() };
    return { id: item.id, ownerUserId: identity.user.id, revision: 2, createdAt: changed.createdAt, updatedAt: changed.updatedAt, encryptedSearchTokens: [], ...await encryptItemForSync(unlocked, changed) } as VaultItemCiphertext;
  });
  offline = false;
  for (const choice of ['local', 'remote', 'copy'] as const) {
    local.encryptedVault = structuredClone(initialDisk);
    const state = (local.encryptedVault as typeof initialDisk).sync; state.conflicts = [remote.id]; state.serverRevision = 2;
    rows.clear(); rows.set(remote.id, remote); revision = 2;
    await vault.resolveConflict(remote.id, choice);
    const passwords = await vault.withVault(async ({ vault: unlocked }) => unlocked.snapshot.items.flatMap(item => item.type === 'login' ? [item.password] : []));
    expect(new Set(passwords)).toEqual(new Set(choice === 'local' ? ['synthetic-login-secret'] : choice === 'remote' ? ['synthetic-remote-secret'] : ['synthetic-login-secret', 'synthetic-remote-secret']));
    expect((local.encryptedVault as typeof initialDisk).sync.conflicts).toEqual([]);
  }
  const access = session.vaultAccess as { expiresAt: number }; access.expiresAt = 0;
  expect(await vault.access()).toBeNull(); expect(session.vaultAccess).toBeUndefined();
  const disk = local.encryptedVault as { identity: string }; disk.identity = toBase64Url(core.encryptXChaCha20(sharedKey, encodeText('{}'), encodeText('wrong-aad')));
  await expect(vault.unlock(password)).rejects.toThrow(); pair.fill(0); sharedKey.fill(0);
});
