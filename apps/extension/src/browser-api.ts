// Both supported browser families implement these Promise APIs. Firefox's
// browser namespace avoids its legacy chrome callback compatibility layer.
export const api: typeof chrome = (globalThis as typeof globalThis & { browser?: typeof chrome }).browser ?? chrome;
export const VERSION = '0.2.2';
export const WEB_VAULT_URL = 'https://zero-vault-web.pages.dev';
declare const __ZERO_VAULT_API_URL__: string | undefined;
export const API_URL = typeof __ZERO_VAULT_API_URL__ === 'string' ? __ZERO_VAULT_API_URL__ : 'https://zero-vault-api.sarainosakura.workers.dev';
export function extensionPage(sender: chrome.runtime.MessageSender, pages: string[]) {
  if (sender.id !== api.runtime.id || !sender.url) return false;
  return pages.some(page => sender.url!.split('?')[0] === api.runtime.getURL(page));
}
