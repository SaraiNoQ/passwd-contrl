import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserMock, contentSender, popupSender, session, local } from './test-browser';
vi.mock('./vault', () => ({ withVault: vi.fn(async () => { throw new Error('vault_locked'); }), saveLogin: vi.fn() }));
beforeEach(() => { vi.resetModules(); installBrowserMock(); vi.useRealTimers(); });
describe('login candidate boundary', () => {
  it('offers a same-origin navigation candidate without exposing its password', async () => {
    const { captureLogin, markReady, candidateDisplay } = await import('./login-capture');
    const first = crypto.randomUUID(); const reply = await captureLogin({ document: first, username: 'fixture', password: 'synthetic-secret' }, contentSender());
    expect(await markReady(contentSender(), crypto.randomUUID())).toEqual({ id: reply.id });
    const display = await candidateDisplay(reply.id!, popupSender());
    expect(display).toMatchObject({ origin: 'https://example.test', locked: true });
    expect(JSON.stringify(display)).not.toContain('synthetic-secret'); expect(local).toEqual({});
  });
  it('blocks HTTP, foreign frames and the vault site', async () => {
    const { captureLogin } = await import('./login-capture');
    for (const sender of [contentSender('http://example.test/login'), { ...contentSender(), frameId: 1 }, contentSender('https://zero-vault-web.pages.dev/')]) await expect(captureLogin({ document: crypto.randomUUID(), username: 'fixture', password: 'synthetic' }, sender)).rejects.toThrow('candidate_mismatch');
  });
  it('does not show a candidate on a different origin or in the original document', async () => {
    const { captureLogin, markReady } = await import('./login-capture');
    const document = crypto.randomUUID(); await captureLogin({ document, username: 'fixture', password: 'synthetic' }, contentSender());
    expect(await markReady(contentSender(), document)).toBeNull();
    expect(await markReady(contentSender('https://other.test/'), crypto.randomUUID())).toBeNull();
  });
  it('expires candidates after five minutes', async () => {
    const { captureLogin, pendingLogins, forUI } = await import('./login-capture');
    const reply = await captureLogin({ document: crypto.randomUUID(), username: 'fixture', password: 'synthetic' }, contentSender());
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 300001);
    expect(await pendingLogins()).toEqual([]); await expect(forUI(reply.id!, popupSender())).rejects.toThrow('candidate_expired'); vi.restoreAllMocks();
  });
  it('binds the isolated prompt to the original tab and HTTPS origin', async () => {
    const { captureLogin, markReady, forUI } = await import('./login-capture');
    const reply = await captureLogin({ document: crypto.randomUUID(), username: 'fixture', password: 'synthetic' }, contentSender());
    await markReady(contentSender(), crypto.randomUUID());
    const prompt: chrome.runtime.MessageSender = { id: 'fixture-id', url: 'chrome-extension://fixture-id/save-prompt.html?candidate=' + reply.id, frameId: 1, tab: { id: 8, url: 'https://example.test/' } as chrome.tabs.Tab };
    await expect(forUI(reply.id!, prompt)).rejects.toThrow('candidate_mismatch');
    expect(await forUI(reply.id!, { ...prompt, tab: { id: 7, url: 'https://example.test/' } as chrome.tabs.Tab })).toMatchObject({ origin: 'https://example.test' });
  });
  it('remembers exclusions without retaining captured credentials', async () => {
    const { captureLogin, excludeCandidate, markReady } = await import('./login-capture');
    const reply = await captureLogin({ document: crypto.randomUUID(), username: 'fixture', password: 'synthetic' }, contentSender());
    await markReady(contentSender(), crypto.randomUUID());
    await excludeCandidate(reply.id!, popupSender());
    expect(local.excludedOrigins).toEqual(['https://example.test']); expect(session.pendingLogins).toEqual([]);
    expect(await captureLogin({ document: crypto.randomUUID(), username: 'fixture', password: 'synthetic' }, contentSender())).toEqual({ ignored: true });
  });
});
