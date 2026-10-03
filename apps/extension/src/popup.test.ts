import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { installBrowserMock } from './test-browser';
beforeEach(() => { vi.resetModules(); installBrowserMock(); document.documentElement.innerHTML = readFileSync(path.resolve('popup.html'), 'utf8'); });
it('renders hostile credential text as text, with similar-origin fill blocked', async () => {
  chrome.runtime.sendMessage = vi.fn(async () => ({ origin: 'https://example.test', connected: true, unlocked: true, fingerprint: '', email: 'fixture@example.test', credentials: [{ id: crypto.randomUUID(), title: '<img src=x onerror=alert(1)>', username: 'fixture', matchType: 'similar' }], pending: [], conflicts: [], lastSync: '', syncError: '' }));
  await import('./popup'); await new Promise(resolve => setTimeout(resolve, 0));
  expect(document.querySelector('#credentials img')).toBeNull();
  expect(document.getElementById('credentials')!.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(document.querySelector('#credentials button')).toBeNull();
});
it('provides a password generator while the vault is locked', async () => {
  chrome.runtime.sendMessage = vi.fn(async () => ({ origin: '', connected: false, unlocked: false, fingerprint: '', credentials: [], pending: [], conflicts: [] }));
  await import('./popup'); await new Promise(resolve => setTimeout(resolve, 0));
  expect((document.getElementById('generated') as HTMLInputElement).value).toHaveLength(20);
  expect(document.querySelector('input[type=password]')).not.toBeNull();
});
