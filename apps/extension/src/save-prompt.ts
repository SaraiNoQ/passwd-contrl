import { api } from './browser-api';
type CandidateDisplay = { id: string; origin: string; username: string; locked: boolean; matches: Array<{ id: string; title: string }>; identical: boolean };
const id = new URLSearchParams(location.search).get('candidate');
const feedback = document.getElementById('feedback')!;
const save = document.getElementById('save') as HTMLButtonElement;
let display: CandidateDisplay | undefined;
let selection: HTMLSelectElement | undefined;
function close() { window.parent.postMessage({ type: 'ZERO_VAULT_PROMPT_CLOSED' }, '*'); document.body.replaceChildren(); }
async function request(type: string, extra: Record<string, unknown> = {}) {
  const reply = await api.runtime.sendMessage({ type, id, ...extra });
  if (reply?.ok === false) throw new Error(reply.error ?? '请打开插件检查待保存信息。');
  return reply;
}
async function load() {
  display = await request('GET_SAVE_PROMPT');
  if (!display) return;
  if (display.identical) { await request('DISMISS_SAVE'); close(); return; }
  document.getElementById('origin')!.textContent = display.origin;
  document.getElementById('username')!.textContent = display.username || '未检测到用户名';
  save.textContent = display.locked ? '解锁以保存' : display.matches.length ? '更新密码' : '保存';
  if (display.matches.length > 1) {
    selection = document.createElement('select'); selection.setAttribute('aria-label', '选择更新的记录');
    for (const item of display.matches) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.title; selection.append(option); }
    document.getElementById('selection')!.append(selection);
  }
}
save.addEventListener('click', async event => {
  if (!event.isTrusted || !display) return;
  save.disabled = true;
  try {
    if (display.locked) { await request('OPEN_UNLOCK'); close(); return; }
    await request('CONFIRM_SAVE', { ...(display.matches.length ? { itemId: selection?.value ?? display.matches[0]!.id } : {}) }); close();
  } catch (error) { feedback.textContent = error instanceof Error ? error.message : '保存失败，请重试。'; save.disabled = false; }
});
document.getElementById('dismiss')!.addEventListener('click', async event => { if (event.isTrusted) { await request('DISMISS_SAVE'); close(); } });
document.getElementById('exclude')!.addEventListener('click', async event => { if (event.isTrusted) { await request('EXCLUDE_SITE'); close(); } });
void load().catch(error => { feedback.textContent = error instanceof Error ? error.message : '待保存信息已失效。'; save.disabled = true; });
