import { vi } from 'vitest';
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, response: (data: unknown) => void) => boolean | void;
export let local: Record<string, unknown>;
export let session: Record<string, unknown>;
export let tabs: { query: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn> };
export const listeners: { internal?: Listener; external?: Listener } = {};
function storage(values: Record<string, unknown>) { return { get: vi.fn(async (key: string) => ({ [key]: values[key] })), set: vi.fn(async (entries: Record<string, unknown>) => { Object.assign(values, structuredClone(entries)); }), remove: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key]; }), setAccessLevel: vi.fn(async () => undefined) }; }
export function installBrowserMock() {
  local = {}; session = {};
  tabs = { query: vi.fn(async () => [{ id: 7, url: 'https://example.test/login' }]), get: vi.fn(async () => ({ id: 7, url: 'https://example.test/login' })), sendMessage: vi.fn(async () => ({ ok: true })) };
  vi.stubGlobal('chrome', { runtime: { id: 'fixture-id', getURL: (path: string) => 'chrome-extension://fixture-id/' + path, onMessage: { addListener: (fn: Listener) => { listeners.internal = fn; } }, onMessageExternal: { addListener: (fn: Listener) => { listeners.external = fn; } }, sendMessage: vi.fn() },
    storage: { local: storage(local), session: storage(session), onChanged: { addListener: vi.fn() } }, tabs: { ...tabs, create: vi.fn(), onRemoved: { addListener: vi.fn() } },
    action: { setBadgeText: vi.fn(async () => undefined) }, alarms: { create: vi.fn(async () => undefined), onAlarm: { addListener: vi.fn() } }, scripting: { executeScript: vi.fn(async () => []) }
  });
}
export const contentSender = (url = 'https://example.test/login'): chrome.runtime.MessageSender => ({ id: 'fixture-id', url, frameId: 0, tab: { id: 7, url } as chrome.tabs.Tab });
export const popupSender = (): chrome.runtime.MessageSender => ({ id: 'fixture-id', url: 'chrome-extension://fixture-id/popup.html', frameId: 0 });
export function send(message: unknown, sender: chrome.runtime.MessageSender) { return new Promise(resolve => { listeners.internal!(message, sender, resolve); }); }
