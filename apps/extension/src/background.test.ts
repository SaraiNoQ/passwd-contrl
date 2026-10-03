import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserMock, popupSender, contentSender, send, local, session, tabs, listeners } from './test-browser';
vi.mock('./vault', () => ({
  serial: (fn: () => unknown) => Promise.resolve().then(fn),
  access: vi.fn(async () => ({ identity: { user: { email: 'fixture@example.test' } } })),
  readDisk: vi.fn(async () => null),
  withVault: vi.fn(async (fn: (ctx: unknown) => unknown) => fn({ vault: { snapshot: { items: [] } }, disk: { sync: { conflicts: [] } } })),
  beginConnect: vi.fn(), finishConnect: vi.fn(), unlock: vi.fn(), lock: vi.fn(),
  synchronize: vi.fn(), resolveConflict: vi.fn(), safeError: () => '操作被拒绝。'
}));
beforeEach(async () => { vi.resetModules(); installBrowserMock(); await import('./background'); });
describe('standalone extension security boundary', () => {
  it('injects the top-level content script only for an explicit fill on an existing page', async () => {
    tabs.sendMessage.mockRejectedValueOnce(new Error('receiving_end_missing'));
    expect(await send({ type: 'FILL_GENERATED_PASSWORD', password: 'synthetic-generated' }, popupSender())).toEqual({ ok: true });
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7, frameIds: [0] }, files: ['dist/content-script.js'] });
    expect(tabs.sendMessage).toHaveBeenCalledTimes(2);
  });
  it('rejects all external credential and fill messages', () => {
    let response: unknown;
    listeners.external!({ type: 'ZERO_VAULT_SESSION_UPDATE', credentials: [{ password: 'synthetic-secret' }] }, {}, value => { response = value; });
    expect(response).toEqual({ ok: false }); expect(session).toEqual({});
  });
  it.each(['GET_POPUP_STATE', 'CONNECT_ACCOUNT', 'UNLOCK_VAULT', 'FILL_MATCHED_CREDENTIAL', 'FILL_GENERATED_PASSWORD', 'RESOLVE_CONFLICT'])('rejects %s from a website content script', async type => {
    expect(await send({ type }, contentSender())).toEqual({ ok: false, error: '操作被拒绝。' });
    expect(tabs.sendMessage).not.toHaveBeenCalled();
  });
  it('returns a password-free popup state to the extension popup', async () => {
    const state = await send({ type: 'GET_POPUP_STATE' }, popupSender());
    expect(state).toMatchObject({ origin: 'https://example.test', connected: false, credentials: [] });
    expect(JSON.stringify(state)).not.toContain('password');
  });
  it('rejects an embedded popup even if its URL is correct', async () => {
    expect(await send({ type: 'UNLOCK_VAULT', password: 'synthetic-secret' }, { ...popupSender(), frameId: 1 })).toMatchObject({ ok: false });
  });
  it('does not persist captured login secrets', async () => {
    const result = await send({ type: 'CAPTURE_LOGIN', input: { document: crypto.randomUUID(), username: 'fixture', password: 'synthetic-secret' } }, contentSender());
    expect(result).toMatchObject({ id: expect.any(String) }); expect(JSON.stringify(local)).not.toContain('synthetic-secret');
    expect(session.pendingLogins).toHaveLength(1);
  });
});
