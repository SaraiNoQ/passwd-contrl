import { client, ready } from '@serenity-kit/opaque';
import { z } from 'zod';
import { mobileSessionResponseSchema, deviceVaultKeyResponseSchema, itemLevelSyncPullResponseSchema, itemLevelSyncResponseSchema, syncConflictResponseSchema, itemLevelEncryptedUpsertSchema, itemLevelEncryptedDeleteSchema, type ItemLevelSyncChange } from '@zero-vault/shared';
import { createLocalVaultWithSharedKey, unlockLocalVault, unlockLocalVaultWithRecoveredKey, sealUnlockedVault, loadCryptoCore, addCredential, updateCredential, deleteItem, decryptItemFromSync, validateEncryptedBackup, type EncryptedLocalVault, type UnlockedVault } from '@zero-vault/browser-vault/local-vault';
import { emptySyncState, syncVault, type SyncState } from '@zero-vault/browser-vault/sync';
import { deviceVaultKeyPacketToBlob } from '@zero-vault/browser-vault/device-packet';
import { toBase64Url, fromBase64Url, encodeText, decodeText, randomBytes } from '@zero-vault/browser-vault/crypto-utils';
import { api, API_URL } from './browser-api';

const identitySchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email() }).strict(),
  device: z.object({ id: z.string().uuid(), publicKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), privateKey: z.string().regex(/^[A-Za-z0-9_-]{43}$/), credential: z.string().regex(/^[A-Za-z0-9_-]{43}$/), fingerprint: z.string().min(8).max(128) }).strict(),
  sessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/), csrfToken: z.string()
}).strict();
type Identity = z.infer<typeof identitySchema>;
type DiskState = { version: 1; owner: string; vault: EncryptedLocalVault; identity: string; sync: SyncState; lastSync?: string; syncError?: string };
const syncStateSchema = z.object({
  cursor: z.number().int().nonnegative(), serverRevision: z.number().int().nonnegative(),
  revisions: z.record(z.string().uuid(), z.number().int().nonnegative()),
  timestamps: z.record(z.string().uuid(), z.string().datetime()), conflicts: z.array(z.string().uuid()),
  pending: z.record(z.string().uuid(), z.object({ itemUpdatedAt: z.string().datetime(), clientMutationId: z.string().uuid(), baseItemRevision: z.number().int().nonnegative().optional(), upsert: itemLevelEncryptedUpsertSchema.optional(), delete: itemLevelEncryptedDeleteSchema.optional() }).strict())
}).strict();
const DISK = 'encryptedVault';
const ACCESS = 'vaultAccess';
const SETUP = 'deviceSetup';
const IDENTITY_AAD = encodeText('zero-vault:extension-identity:v1');
const TTL = 5 * 60_000;
type Access = { key: string; identity: Identity; expiresAt: number };
type Setup = { identity: Identity; status: 'pending' | 'approved' };
let queue: Promise<unknown> = Promise.resolve();
export function serial<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work); queue = next.catch(() => undefined); return next;
}
export async function core() { return loadCryptoCore(api.runtime.getURL('dist/crypto_core_bg.wasm')); }
export async function readDisk(): Promise<DiskState | null> {
  const disk = (await api.storage.local.get(DISK))[DISK] as DiskState | undefined;
  if (!disk) return null;
  if (disk.version !== 1 || !validateEncryptedBackup(disk.vault) || disk.vault.runtime !== 'crypto-core-wasm' || !disk.vault.kdf.wrappedVaultKey || ![disk.vault.kdf.memoryKib, disk.vault.kdf.iterations, disk.vault.kdf.parallelism].every(Number.isSafeInteger) || disk.vault.kdf.memoryKib < 19456 || disk.vault.kdf.memoryKib > 262144 || disk.vault.kdf.iterations < 2 || disk.vault.kdf.iterations > 10 || disk.vault.kdf.parallelism !== 1 || fromBase64Url(disk.vault.kdf.salt).length !== 16 || fromBase64Url(disk.vault.kdf.wrappedVaultKey).length !== 72 || !disk.sync || !Number.isSafeInteger(disk.sync.cursor) || disk.sync.cursor < 0 || !Number.isSafeInteger(disk.sync.serverRevision) || disk.sync.serverRevision < 0) throw new Error('local_data_invalid');
  if (!z.string().uuid().safeParse(disk.owner).success || !z.string().regex(/^[A-Za-z0-9_-]+$/).max(349528).safeParse(disk.identity).success || !syncStateSchema.safeParse(disk.sync).success) throw new Error('local_data_invalid');
  return disk;
}
async function writeDisk(disk: DiskState) { await api.storage.local.set({ [DISK]: disk }); }
export async function lock() {
  const pending = ((await api.storage.session.get('pendingLogins')).pendingLogins ?? []) as Array<{ tabId: number }>;
  await api.storage.session.remove([ACCESS, SETUP, 'pendingLogins']);
  for (const tabId of new Set(pending.map(item => item.tabId))) await api.action.setBadgeText({ tabId, text: '' });
  await api.action.setBadgeText({ text: '' });
}
export async function access(touch = false): Promise<Access | null> {
  const entry = (await api.storage.session.get(ACCESS))[ACCESS] as Access | undefined;
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) { await lock(); return null; }
  if (touch) { entry.expiresAt = Date.now() + TTL; await api.storage.session.set({ [ACCESS]: entry }); }
  return entry;
}
async function request(path: string, init: RequestInit = {}, identity?: Identity): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(API_URL + path, { ...init, credentials: 'omit', redirect: 'error', signal: controller.signal, headers: {
      'content-type': 'application/json', ...(identity ? { authorization: `Bearer ${identity.sessionToken}`, 'x-zero-vault-csrf': identity.csrfToken } : {}), ...init.headers
    } });
    const body: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 409 && path === '/vault/item-sync' && init.method === 'POST') {
        const conflict = syncConflictResponseSchema.parse(body);
        const { error: _error, ...data } = conflict;
        return itemLevelSyncResponseSchema.parse({ protocol: 'item_level_v1', ...data });
      }
      if (identity && (response.status === 401 || response.status === 403)) await lock();
      const error = z.object({ error: z.string() }).safeParse(body);
      throw new Error(error.success ? error.data.error : 'request_failed');
    }
    return body;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof DOMException && error.name === 'AbortError')) throw new Error('network_error');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function login(email: string, password: string, device: Identity['device']): Promise<Setup> {
  await ready;
  const start = client.startLogin({ password });
  const response = z.object({ loginSessionId: z.string(), loginResponse: z.string() }).parse(await request('/auth/login/start', { method: 'POST', body: JSON.stringify({ email, startLoginRequest: start.startLoginRequest }) }));
  const finish = client.finishLogin({ password, clientLoginState: start.clientLoginState, loginResponse: response.loginResponse, identifiers: { client: email, server: 'zero-vault' } });
  if (!finish) throw new Error('invalid_credentials');
  const session = mobileSessionResponseSchema.parse(await request('/auth/extension/login/finish', { method: 'POST', body: JSON.stringify({ loginSessionId: response.loginSessionId, finishLoginRequest: finish.finishLoginRequest, device: { id: device.id, name: `Zero Vault · 浏览器插件`, publicKey: device.publicKey, fingerprint: device.fingerprint, credential: device.credential } }) }));
  if (session.device.id !== device.id) throw new Error('device_identity_mismatch');
  return { identity: identitySchema.parse({ user: { id: session.user.id, email: session.user.email }, device, sessionToken: session.sessionToken, csrfToken: session.csrfToken }), status: session.device.status };
}
export async function beginConnect(email: string, password: string) {
  if (await readDisk()) throw new Error('already_connected');
  const wasm = await core();
  const pair = wasm.generateDeviceKeypair();
  try {
    const publicKey = pair.slice(32);
    const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', publicKey)), b => b.toString(16).padStart(2, '0')).join('');
    const device = { id: crypto.randomUUID(), publicKey: toBase64Url(publicKey), privateKey: toBase64Url(pair.slice(0, 32)), credential: toBase64Url(randomBytes(32)), fingerprint };
    const setup = await login(email.trim().toLowerCase(), password, device);
    await api.storage.session.set({ [SETUP]: setup });
    return { status: setup.status, fingerprint };
  } finally { pair.fill(0); }
}
async function getSetup(): Promise<Setup> {
  const setup = (await api.storage.session.get(SETUP))[SETUP] as Setup | undefined;
  if (!setup) throw new Error('setup_expired');
  const identity = identitySchema.parse(setup.identity);
  const self = z.object({ device: z.object({ id: z.string(), status: z.enum(['pending', 'approved', 'rejected', 'revoked']) }) }).parse(await request('/devices/self', {}, identity));
  if (self.device.id !== identity.device.id || !['pending', 'approved'].includes(self.device.status)) throw new Error('device_not_trusted');
  return { identity, status: self.device.status as Setup['status'] };
}
export async function finishConnect(password: string) {
  if (password.length < 12) throw new Error('password_too_short');
  if (await readDisk()) throw new Error('already_connected');
  const setup = await getSetup();
  if (setup.status !== 'approved') throw new Error('device_approval_required');
  const identity = setup.identity;
  const response = deviceVaultKeyResponseSchema.parse(await request(`/devices/${identity.device.id}/key`, {}, identity));
  const packet = response.encryptedVaultKeyPacket;
  if (packet.recipientDeviceId !== identity.device.id || packet.recipientPublicKey !== identity.device.publicKey) throw new Error('device_identity_mismatch');
  const wasm = await core(); const privateKey = fromBase64Url(identity.device.privateKey);
  let key: Uint8Array;
  try { key = wasm.decryptOnDevice(privateKey, fromBase64Url(deviceVaultKeyPacketToBlob(packet))); }
  finally { privateKey.fill(0); }
  try {
    const created = await createLocalVaultWithSharedKey(password, key);
    if (created.encrypted.runtime !== 'crypto-core-wasm') throw new Error('native_crypto_required');
    const kdf = created.encrypted.kdf;
    const passwordKey = wasm.deriveVaultKey(password, fromBase64Url(kdf.salt), kdf.memoryKib, kdf.iterations, kdf.parallelism);
    try {
      const sealed = toBase64Url(wasm.encryptXChaCha20(passwordKey, encodeText(JSON.stringify(identity)), IDENTITY_AAD));
      await writeDisk({ version: 1, owner: identity.user.id, vault: created.encrypted, identity: sealed, sync: emptySyncState() });
      await api.storage.session.set({ [ACCESS]: { key: toBase64Url(key), identity, expiresAt: Date.now() + TTL } });
      await api.storage.session.remove(SETUP);
    } finally { passwordKey.fill(0); created.unlocked.key instanceof Uint8Array && created.unlocked.key.fill(0); }
  } finally { key.fill(0); }
  await synchronize().catch(() => undefined);
}
export async function unlock(password: string, accountPassword?: string) {
  const disk = await readDisk(); if (!disk || disk.vault.runtime !== 'crypto-core-wasm') throw new Error('not_connected');
  const wasm = await core(); const kdf = disk.vault.kdf;
  const passwordKey = wasm.deriveVaultKey(password, fromBase64Url(kdf.salt), kdf.memoryKib, kdf.iterations, kdf.parallelism);
  let key: Uint8Array | undefined;
  try {
    let identity = identitySchema.parse(JSON.parse(decodeText(wasm.decryptXChaCha20(passwordKey, fromBase64Url(disk.identity), IDENTITY_AAD))));
    if (identity.user.id !== disk.owner) throw new Error('account_mismatch');
    const vault = await unlockLocalVault(password, disk.vault);
    if (vault.runtime !== 'crypto-core-wasm') throw new Error('native_crypto_required');
    key = vault.key;
    if (accountPassword) {
      const renewed = await login(identity.user.email, accountPassword, identity.device);
      if (renewed.identity.user.id !== disk.owner || renewed.status !== 'approved') throw new Error('device_not_trusted');
      identity = renewed.identity;
      disk.identity = toBase64Url(wasm.encryptXChaCha20(passwordKey, encodeText(JSON.stringify(identity)), IDENTITY_AAD));
      await writeDisk(disk);
    }
    await api.storage.session.set({ [ACCESS]: { key: toBase64Url(key), identity, expiresAt: Date.now() + TTL } });
  } finally { passwordKey.fill(0); key?.fill(0); }
  await synchronize().catch(() => undefined);
}
export async function unlocked(touch = false) {
  const session = await access(touch); const disk = await readDisk();
  if (!session || !disk || disk.owner !== session.identity.user.id) throw new Error('vault_locked');
  await core(); const key = fromBase64Url(session.key);
  try { return { session, disk, vault: await unlockLocalVaultWithRecoveredKey(disk.vault, key) }; }
  catch (error) { key.fill(0); throw error; }
}
export async function withVault<T>(fn: (context: Awaited<ReturnType<typeof unlocked>>) => Promise<T>, touch = false) {
  const context = await unlocked(touch);
  try { return await fn(context); } finally { if (context.vault.key instanceof Uint8Array) context.vault.key.fill(0); }
}
export async function persist(disk: DiskState, vault: UnlockedVault) { disk.vault = await sealUnlockedVault(vault); await writeDisk(disk); }
export async function synchronize() {
  if (!await access()) return;
  try {
    await withVault(async ({ session, disk, vault }) => {
      const result = await syncVault(vault, disk.owner, disk.sync, {
        push: plan => request('/vault/item-sync', { method: 'POST', body: JSON.stringify(plan) }, session.identity),
        pull: cursor => request(`/vault/item-sync?cursor=${cursor}`, {}, session.identity),
        async commit(state, next) { if (!await access()) throw new Error('vault_locked'); disk.sync = structuredClone(state); if (next) await persist(disk, next); else await writeDisk(disk); }
      });
      disk.sync = result.state; disk.lastSync = new Date().toISOString(); delete disk.syncError; await writeDisk(disk);
    });
  } catch (error) {
    const disk = await readDisk(); if (disk) { disk.syncError = safeError(error); await writeDisk(disk); }
    throw error;
  }
}
export async function saveLogin(origin: string, username: string, password: string, itemId?: string) {
  await withVault(async ({ disk, vault }) => {
    if (itemId) {
      const item = vault.snapshot.items.find(i => i.id === itemId);
      if (!item || item.type !== 'login' || item.origin !== origin || item.username !== username) throw new Error('candidate_mismatch');
      await persist(disk, updateCredential(vault, itemId, { password }));
    } else await persist(disk, addCredential(vault, { title: new URL(origin).hostname, origin, username, password, notes: '' }));
  }, true);
  await synchronize().catch(() => undefined);
}
export async function resolveConflict(itemId: string, choice: 'local' | 'remote' | 'copy') {
  await withVault(async ({ disk, vault, session }) => {
    if (!disk.sync.conflicts.includes(itemId)) throw new Error('conflict_missing');
    let remote: ItemLevelSyncChange | undefined; let cursor = 0;
    // ponytail: conflict lookup scans the change feed; add an item endpoint if histories become large.
    for (let page = 0; page < 1000; page++) {
      const pulled = itemLevelSyncPullResponseSchema.parse(await request(`/vault/item-sync?cursor=${cursor}`, {}, session.identity));
      if (pulled.cursor < cursor || (pulled.hasMore && pulled.cursor <= cursor)) throw new Error('sync_cursor_invalid');
      for (const change of pulled.changes) if ((change.operation === 'upsert' ? change.item.id : change.itemId) === itemId) remote = change;
      cursor = pulled.cursor; if (!pulled.hasMore) break; if (page === 999) throw new Error('sync_page_limit');
    }
    const local = vault.snapshot.items.find(i => i.id === itemId);
    if (choice === 'copy' && local) vault = { ...vault, snapshot: { ...vault.snapshot, items: [...vault.snapshot.items, { ...local, id: crypto.randomUUID(), title: `${local.title}（副本）`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }] } };
    if (choice !== 'local') {
      if (remote?.operation === 'upsert') {
        if (remote.item.ownerUserId !== disk.owner) throw new Error('account_mismatch');
        const item = await decryptItemFromSync(vault, remote.item.encryptedItemKey, remote.item.encryptedPayload, itemId);
        vault = { ...vault, snapshot: { ...vault.snapshot, items: [...vault.snapshot.items.filter(i => i.id !== itemId), item] } }; disk.sync.timestamps[itemId] = item.updatedAt;
      } else { vault = deleteItem(vault, itemId); delete disk.sync.timestamps[itemId]; }
    } else delete disk.sync.timestamps[itemId];
    const revision = remote?.operation === 'upsert' ? remote.item.revision : remote?.revision;
    if (revision !== undefined && (choice === 'local' || remote?.operation === 'upsert')) disk.sync.revisions[itemId] = revision;
    else delete disk.sync.revisions[itemId];
    delete disk.sync.pending[itemId]; disk.sync.conflicts = disk.sync.conflicts.filter(id => id !== itemId);
    await persist(disk, vault);
  }, true);
  await synchronize();
}
export function safeError(error: unknown): string {
  const messages: Record<string, string> = {
    network_error: '网络连接失败，已保存的本地变更会在联网后重试。', invalid_credentials: '账户或密码不正确。', device_approval_required: '请先在网页或手机批准此插件设备，再重试。',
    invalid_device_credential: '设备身份无效，请检查账户或设备批准状态。', device_not_trusted: '此插件设备已被撤销。', not_authenticated: '云端会话已过期，请锁定后填写账户密码重新登录。',
    vault_locked: '请先解锁插件密码库。', password_too_short: '本地主密码至少需要 12 个字符。', setup_expired: '连接会话已失效，请重新连接账户。', local_data_invalid: '本地加密数据无效，请保留数据并联系维护者。',
    already_connected: '此插件已连接账户，请先解锁。', not_connected: '请先连接已有账户。', candidate_expired: '待保存信息已过期，请重新登录网站。', candidate_mismatch: '网站或账号已改变，请重新检查。', invalid_generator_options: '请选择至少一种字符，长度需要为 8–128 位。',
    site_access_required: '请允许插件访问此 HTTPS 网站，刷新网页后重试。', fill_target_unavailable: '当前网页没有可安全填充的表单，请检查网页或手动填写。'
  };
  return error instanceof Error && messages[error.message] || '操作未完成，请检查密码、设备批准状态或网络后重试。';
}
