import { api, WEB_VAULT_URL, API_URL, extensionPage } from './browser-api';
import { withVault, saveLogin } from './vault';
import { z } from 'zod';

export const CANDIDATE_TTL = 5 * 60_000;
const KEY = 'pendingLogins';
const candidateInput = z.object({ username: z.string().max(1024), password: z.string().min(1).max(4096), document: z.string().uuid() }).strict();
export type PendingLogin = z.infer<typeof candidateInput> & { id: string; tabId: number; origin: string; capturedAt: number; ready: boolean };
function senderOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.id !== api.runtime.id || sender.frameId !== 0 || !sender.tab?.id || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    if (url.protocol !== 'https:' || [WEB_VAULT_URL, API_URL].includes(url.origin) || url.hostname === 'localhost' || url.hostname === '127.0.0.1') return null;
    return url.origin;
  } catch { return null; }
}
export async function pendingLogins(): Promise<PendingLogin[]> {
  const entries = (await api.storage.session.get(KEY))[KEY] as PendingLogin[] | undefined;
  const valid = (entries ?? []).filter(entry => entry.capturedAt + CANDIDATE_TTL > Date.now());
  if (entries?.length !== valid.length) {
    await api.storage.session.set({ [KEY]: valid });
    for (const entry of entries ?? []) if (!valid.some(item => item.tabId === entry.tabId)) await api.action.setBadgeText({ tabId: entry.tabId, text: '' });
  }
  return valid;
}
export async function captureLogin(message: unknown, sender: chrome.runtime.MessageSender) {
  const origin = senderOrigin(sender);
  const parsed = candidateInput.safeParse(message);
  if (!origin || !parsed.success) throw new Error('candidate_mismatch');
  const excluded = ((await api.storage.local.get('excludedOrigins')).excludedOrigins ?? []) as string[];
  if (excluded.includes(origin)) return { ignored: true };
  const entries = (await pendingLogins()).filter(entry => entry.tabId !== sender.tab!.id);
  const candidate: PendingLogin = { ...parsed.data, id: crypto.randomUUID(), tabId: sender.tab!.id!, origin, capturedAt: Date.now(), ready: false };
  entries.push(candidate); await api.storage.session.set({ [KEY]: entries });
  return { id: candidate.id };
}
export async function markReady(sender: chrome.runtime.MessageSender, document: string, id?: string) {
  const origin = senderOrigin(sender); if (!origin) return null;
  const entries = await pendingLogins();
  const candidate = entries.find(entry => entry.tabId === sender.tab!.id && entry.origin === origin && (id ? entry.id === id : entry.document !== document));
  if (!candidate) {
    const redirected = entries.find(entry => entry.tabId === sender.tab!.id && entry.origin !== origin && entry.document !== document);
    if (redirected) await api.action.setBadgeText({ tabId: redirected.tabId, text: '+' });
    return null;
  }
  candidate.ready = true; await api.storage.session.set({ [KEY]: entries });
  try {
    const identical = await withVault(async ({ vault }) => vault.snapshot.items.some(item => item.type === 'login' && item.origin === candidate.origin && item.username === candidate.username && item.password === candidate.password));
    if (identical) { await discard(candidate.id); return null; }
  } catch { /* A locked vault may still offer an unlock-to-save prompt. */ }
  await api.action.setBadgeText({ tabId: candidate.tabId, text: '+' });
  return { id: candidate.id };
}
export async function discard(id: string) {
  const entries = await pendingLogins(); const candidate = entries.find(entry => entry.id === id);
  await api.storage.session.set({ [KEY]: entries.filter(entry => entry.id !== id) });
  if (candidate) await api.action.setBadgeText({ tabId: candidate.tabId, text: '' });
}
export async function forUI(id: string, sender: chrome.runtime.MessageSender) {
  const candidate = (await pendingLogins()).find(entry => entry.id === id);
  if (!candidate) throw new Error('candidate_expired');
  const prompt = extensionPage(sender, ['save-prompt.html']);
  const popup = extensionPage(sender, ['popup.html']);
  if (!prompt && !popup) throw new Error('candidate_mismatch');
  if (popup && !candidate.ready) {
    const tab = await api.tabs.get(candidate.tabId);
    if (!tab.url || new URL(tab.url).origin === candidate.origin) throw new Error('candidate_mismatch');
  }
  if (prompt && (!candidate.ready || sender.tab?.id !== candidate.tabId || !sender.tab?.url || new URL(sender.tab.url).origin !== candidate.origin)) throw new Error('candidate_mismatch');
  return candidate;
}
export async function candidateDisplay(id: string, sender: chrome.runtime.MessageSender) {
  const candidate = await forUI(id, sender);
  let matches: Array<{ id: string; title: string }> = []; let locked = true; let identical = false;
  try {
    await withVault(async ({ vault }) => {
      locked = false;
      const items = vault.snapshot.items.filter(item => item.type === 'login' && item.origin === candidate.origin && item.username === candidate.username);
      identical = items.some(item => item.type === 'login' && item.password === candidate.password);
      matches = items.map(item => ({ id: item.id, title: item.title }));
    });
  } catch { /* Keep credentials masked while locked. */ }
  return { id, origin: candidate.origin, username: candidate.username, locked, matches, identical };
}
export async function confirmCandidate(id: string, itemId: string | undefined, sender: chrome.runtime.MessageSender) {
  const candidate = await forUI(id, sender);
  const display = await candidateDisplay(id, sender);
  if (display.identical) { await discard(id); return; }
  if (display.matches.length && !itemId || itemId && !display.matches.some(item => item.id === itemId)) throw new Error('candidate_mismatch');
  await saveLogin(candidate.origin, candidate.username, candidate.password, itemId);
  await discard(id);
}
export async function excludeCandidate(id: string, sender: chrome.runtime.MessageSender) {
  const candidate = await forUI(id, sender);
  const origins = ((await api.storage.local.get('excludedOrigins')).excludedOrigins ?? []) as string[];
  await api.storage.local.set({ excludedOrigins: [...new Set([...origins, candidate.origin])] });
  await discard(id);
}
