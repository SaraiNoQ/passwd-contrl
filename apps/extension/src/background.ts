import { api, VERSION, extensionPage } from './browser-api';
import { z } from 'zod';
import { access, beginConnect, finishConnect, unlock, lock, readDisk, withVault, synchronize, resolveConflict, safeError, serial } from './vault';
import { captureLogin, markReady, pendingLogins, candidateDisplay, confirmCandidate, discard, excludeCandidate, forUI } from './login-capture';
import { classifyOriginMatch } from './origin-matching';
import { generateTotpCode } from './totp';

const UI_PAGES = ['popup.html'];
const credentialId = z.string().uuid();
async function activeTab() { return (await api.tabs.query({ active: true, currentWindow: true }))[0]; }
async function sendFill(tabId: number, message: { origin: string; type: string; password: string; username?: string }) {
  let response;
  try { response = await api.tabs.sendMessage(tabId, message, { frameId: 0 }); }
  catch {
    // Explicit fill may be the first interaction with a page opened before installation.
    try {
      await api.scripting.executeScript({ target: { tabId, frameIds: [0] }, files: ['dist/content-script.js'] });
      const current = await api.tabs.get(tabId);
      if (!current.url || new URL(current.url).origin !== message.origin) throw new Error('candidate_mismatch');
      response = await api.tabs.sendMessage(tabId, message, { frameId: 0 });
    } catch { throw new Error('site_access_required'); }
  }
  if (!response?.ok) throw new Error('fill_target_unavailable');
}
async function popupState() {
  const tab = await activeTab();
  let origin = '';
  try { origin = new URL(tab?.url ?? '').origin; } catch { /* Browser internal page. */ }
  const disk = await readDisk();
  const session = await access();
  const setup = (await api.storage.session.get('deviceSetup')).deviceSetup as { identity: { device: { fingerprint: string } } } | undefined;
  const state = { version: VERSION, origin, connected: !!disk, unlocked: !!session, email: session?.identity.user.email ?? '', fingerprint: setup?.identity.device.fingerprint ?? '', credentials: [] as Array<{ id: string; title: string; username: string; matchType: string; hasTotp?: boolean }>, pending: [] as Array<{ id: string; origin: string; username: string }>, conflicts: [] as Array<{ id: string; title: string }>, lastSync: disk?.lastSync ?? '', syncError: disk?.syncError ?? '' };
  state.pending = (await pendingLogins()).filter(entry => entry.tabId === tab?.id && (entry.ready || entry.origin !== origin)).map(entry => ({ id: entry.id, origin: entry.origin, username: entry.username }));
  if (session) await withVault(async ({ vault, disk }) => {
    state.credentials = vault.snapshot.items.filter(item => item.type === 'login').map(item => ({ id: item.id, title: item.title, username: item.type === 'login' ? item.username : '', hasTotp: item.type === 'login' && !!item.totp, matchType: item.type === 'login' ? classifyOriginMatch(origin, item.origin) : 'different' })).filter(item => item.matchType !== 'different');
    state.conflicts = disk.sync.conflicts.map(id => ({ id, title: vault.snapshot.items.find(item => item.id === id)?.title ?? '已删除的条目' }));
  });
  return state;
}
async function fill(id: string) {
  const tab = await activeTab();
  if (!tab?.id || !tab.url) throw new Error('candidate_mismatch');
  const origin = new URL(tab.url).origin;
  return withVault(async ({ vault }) => {
    const item = vault.snapshot.items.find(item => item.id === id);
    if (!item || item.type !== 'login' || classifyOriginMatch(origin, item.origin) !== 'exact') throw new Error('candidate_mismatch');
    // Re-check tab navigation before sending; the content script re-checks origin and visibility.
    const current = await api.tabs.get(tab.id!);
    if (!current.url || new URL(current.url).origin !== origin) throw new Error('candidate_mismatch');
    if (!await access()) throw new Error('vault_locked');
    await sendFill(tab.id!, { type: 'FILL_CREDENTIAL', origin, username: item.username, password: item.password });
  }, true);
}
async function route(raw: unknown, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const message = z.object({ type: z.string() }).passthrough().parse(raw);
  if (message.type === 'CAPTURE_LOGIN') return captureLogin(message.input, sender);
  if (message.type === 'PAGE_READY' || message.type === 'LOGIN_FORM_GONE') {
    const input = z.object({ document: z.string().uuid(), id: z.string().uuid().optional() }).parse(message);
    return markReady(sender, input.document, input.id);
  }
  if (['GET_SAVE_PROMPT', 'CONFIRM_SAVE', 'DISMISS_SAVE', 'EXCLUDE_SITE', 'OPEN_UNLOCK'].includes(message.type)) {
    const input = z.object({ id: credentialId, itemId: credentialId.optional() }).parse(message);
    await forUI(input.id, sender);
    if (message.type === 'GET_SAVE_PROMPT') return candidateDisplay(input.id, sender);
    if (message.type === 'CONFIRM_SAVE') { await confirmCandidate(input.id, input.itemId, sender); return { ok: true }; }
    if (message.type === 'EXCLUDE_SITE') await excludeCandidate(input.id, sender);
    else if (message.type === 'DISMISS_SAVE') await discard(input.id);
    else await api.tabs.create({ url: api.runtime.getURL('popup.html') + '?candidate=' + input.id });
    return { ok: true };
  }
  if (!extensionPage(sender, UI_PAGES) || (sender.frameId !== undefined && sender.frameId !== 0)) throw new Error('untrusted_sender');
  if (message.type === 'GET_POPUP_STATE') return popupState();
  if (message.type === 'GET_EXTENSION_STATUS') return { installed: true, version: VERSION, credentialsLoaded: !!await access() };
  if (message.type === 'CONNECT_ACCOUNT') {
    const input = z.object({ email: z.string().email(), password: z.string().min(1).max(4096) }).parse(message);
    return beginConnect(input.email, input.password);
  }
  if (message.type === 'FINISH_CONNECT') { await finishConnect(z.string().min(12).max(4096).parse(message.password)); return { ok: true }; }
  if (message.type === 'UNLOCK_VAULT') {
    const input = z.object({ password: z.string().min(1).max(4096), accountPassword: z.string().max(4096).optional() }).parse(message);
    await unlock(input.password, input.accountPassword || undefined); return { ok: true };
  }
  if (message.type === 'LOCK_VAULT') { await lock(); return { ok: true }; }
  if (message.type === 'SYNC_NOW') { await synchronize(); return { ok: true }; }
  if (message.type === 'RESOLVE_CONFLICT') {
    const input = z.object({ itemId: credentialId, choice: z.enum(['local', 'remote', 'copy']) }).parse(message);
    await resolveConflict(input.itemId, input.choice); return { ok: true };
  }
  if (message.type === 'FILL_MATCHED_CREDENTIAL') { await fill(credentialId.parse(message.credentialId)); return { ok: true }; }
  if (message.type === 'GET_TOTP_CODE') {
    const id = credentialId.parse(message.credentialId); const tab = await activeTab();
    return withVault(async ({ vault }) => {
      const item = vault.snapshot.items.find(item => item.id === id);
      if (!tab?.url || !item || item.type !== 'login' || !item.totp || classifyOriginMatch(new URL(tab.url).origin, item.origin) !== 'exact') throw new Error('candidate_mismatch');
      return generateTotpCode(item.totp);
    }, true);
  }
  if (message.type === 'FILL_GENERATED_PASSWORD') {
    const password = z.string().min(8).max(128).parse(message.password);
    const tab = await activeTab();
    if (!tab?.id || !tab.url || new URL(tab.url).protocol !== 'https:') throw new Error('candidate_mismatch');
    await sendFill(tab.id, { type: 'FILL_GENERATED_PASSWORD', origin: new URL(tab.url).origin, password }); return { ok: true };
  }
  throw new Error('invalid_message');
}
api.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (message && typeof message === 'object' && 'type' in message && message.type === 'LOCK_VAULT' && extensionPage(sender, UI_PAGES) && (sender.frameId === undefined || sender.frameId === 0)) {
    void lock().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false, error: '锁定失败，请重试。' })); return true;
  }
  void serial(() => route(message, sender)).then(sendResponse, error => sendResponse({ ok: false, error: safeError(error) }));
  return true;
});
// Standalone vaults never accept credentials or fill requests from websites.
api.runtime.onMessageExternal?.addListener((_message, _sender, sendResponse) => { sendResponse({ ok: false }); return false; });
async function initialize() {
  await api.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  await api.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  await api.alarms.create('vault-maintenance', { periodInMinutes: 1 });
}
void initialize();
api.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'vault-maintenance') void serial(async () => { await pendingLogins(); await access(); await synchronize(); }).catch(() => undefined);
});
api.tabs.onRemoved.addListener(tabId => {
  void serial(async () => {
    const entries = (await pendingLogins()).filter(entry => entry.tabId !== tabId);
    await api.storage.session.set({ pendingLogins: entries });
  });
});
