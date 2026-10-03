import { api } from './browser-api';
import { generatePassword } from '@zero-vault/browser-vault/password-generator';
type State = { origin: string; connected: boolean; unlocked: boolean; fingerprint: string; email: string; credentials: Array<{ id: string; title: string; username: string; matchType: string; hasTotp?: boolean }>; pending: Array<{ id: string; origin: string; username: string }>; conflicts: Array<{ id: string; title: string }>; lastSync: string; syncError: string };
type Candidate = { id: string; origin: string; username: string; locked: boolean; matches: Array<{ id: string; title: string }>; identical: boolean };
const feedback = document.getElementById('feedback')!;
const connection = document.getElementById('connection')!;
const credentials = document.getElementById('credentials')!;
const pending = document.getElementById('pending')!;
const conflicts = document.getElementById('conflicts')!;
const generated = document.getElementById('generated') as HTMLInputElement;
function text(value: string, tag = 'p', className = '') { const node = document.createElement(tag); node.textContent = value; node.className = className; return node; }
function status(value: string, error = false) { feedback.textContent = value; feedback.classList.toggle('error', error); }
async function request(type: string, fields: Record<string, unknown> = {}) {
  const reply = await api.runtime.sendMessage({ type, ...fields });
  if (reply?.ok === false) throw new Error(reply.error || '操作未完成，请重试。');
  if (!reply) throw new Error('插件后台未响应，请重新打开插件。');
  return reply;
}
function action(label: string, work: () => Promise<void>, primary = false) {
  const button = document.createElement('button'); button.type = 'button'; button.textContent = label; if (primary) button.className = 'primary';
  button.addEventListener('click', async event => {
    if (!event.isTrusted) return;
    button.disabled = true;
    try { await work(); } catch (error) { status(error instanceof Error ? error.message : '操作未完成，请重试。', true); }
    finally { button.disabled = false; }
  });
  return button;
}
function input(form: HTMLFormElement, id: string) { return form.elements.namedItem(id) as HTMLInputElement; }
function submit(form: HTMLFormElement, work: () => Promise<void>) {
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!event.isTrusted || !form.reportValidity()) return;
    const button = form.querySelector('button')!; button.disabled = true; status('处理中…');
    try { await work(); await refresh(); }
    catch (error) { status(error instanceof Error ? error.message : '操作未完成，请重试。', true); }
    finally { form.querySelectorAll<HTMLInputElement>('input[type=password]').forEach(field => { field.value = ''; }); button.disabled = false; }
  });
}
async function renderPending(entries: State['pending']) {
  pending.replaceChildren();
  const queryId = new URLSearchParams(location.search).get('candidate');
  const ids = [...new Set([...entries.map(entry => entry.id), ...(queryId ? [queryId] : [])])];
  if (!ids.length) return;
  pending.append(text('待保存的登录信息', 'h2'));
  for (const id of ids) {
    let item: Candidate;
    try { item = await request('GET_SAVE_PROMPT', { id }); } catch { continue; }
    if (item.identical) continue;
    const row = document.createElement('div'); row.className = 'credential';
    row.append(text(item.origin, 'strong'), text(item.username || '未检测到用户名', 'small'), text('密码：••••••••••••', 'small'));
    let select: HTMLSelectElement | undefined;
    if (item.matches.length > 1) {
      select = document.createElement('select'); select.setAttribute('aria-label', '选择更新的记录');
      for (const match of item.matches) { const option = document.createElement('option'); option.value = match.id; option.textContent = match.title; select.append(option); } row.append(select);
    }
    const controls = document.createElement('div'); controls.className = 'actions';
    if (!item.locked) controls.append(action(item.matches.length ? '更新密码' : '保存', async () => {
      await request('CONFIRM_SAVE', { id, ...(item.matches.length ? { itemId: select?.value ?? item.matches[0]!.id } : {}) }); status('已加密保存。'); await refresh();
    }, true));
    else row.append(text('先在上方解锁，再确认保存。', 'small'));
    controls.append(action('暂不保存', async () => { await request('DISMISS_SAVE', { id }); await refresh(); }));
    row.append(controls); pending.append(row);
  }
}
async function refresh() {
  const state: State = await request('GET_POPUP_STATE');
  document.getElementById('origin')!.textContent = state.origin.startsWith('https:') ? state.origin : '当前页面无法填充';
  connection.replaceChildren(); credentials.replaceChildren(); conflicts.replaceChildren();
  if (!state.connected && !state.fingerprint) {
    connection.innerHTML = '<h2>连接已有账户</h2><p class="muted">由网页或手机批准插件设备后，即可独立使用。</p><form id="connect"><label for="email">账户邮箱</label><input id="email" name="email" type="email" autocomplete="username" required><label for="account-password">账户密码</label><input id="account-password" name="account-password" type="password" autocomplete="current-password" required><div class="actions"><button class="primary" type="submit">连接账户</button></div></form>';
    const form = document.getElementById('connect') as HTMLFormElement;
    submit(form, async () => { await request('CONNECT_ACCOUNT', { email: input(form, 'email').value, password: input(form, 'account-password').value }); status('请核对指纹，在网页或手机批准此设备。'); });
    (document.getElementById('generator') as HTMLDetailsElement).open = true;
  } else if (!state.connected) {
    connection.append(text('批准此插件设备', 'h2'), text('在网页或手机的设备管理中核对以下指纹。', 'p', 'muted'), text(state.fingerprint, 'p', 'fingerprint'));
    const form = document.createElement('form');
    form.innerHTML = '<label for="local-password">插件本地主密码（至少 12 位）</label><input id="local-password" name="local-password" type="password" autocomplete="new-password" minlength="12" required><label for="confirm-password">再次输入本地主密码</label><input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" minlength="12" required><div class="actions"><button class="primary" type="submit">已批准，完成连接</button></div>';
    connection.append(form, text('连接完成前请不要重启浏览器。', 'small'));
    submit(form, async () => {
      if (input(form, 'local-password').value !== input(form, 'confirm-password').value) throw new Error('两次输入的本地主密码不一致。');
      await request('FINISH_CONNECT', { password: input(form, 'local-password').value }); status('设备已连接，密码库已解锁。');
    });
  } else if (!state.unlocked) {
    connection.innerHTML = '<h2>解锁插件密码库</h2><form id="unlock"><label for="local-password">插件本地主密码</label><input id="local-password" name="local-password" type="password" autocomplete="current-password" required><label for="renew-password">账户密码（云端会话过期时填写）</label><input id="renew-password" name="renew-password" type="password" autocomplete="off"><div class="actions"><button class="primary" type="submit">解锁</button></div></form>';
    const form = document.getElementById('unlock') as HTMLFormElement;
    submit(form, async () => { await request('UNLOCK_VAULT', { password: input(form, 'local-password').value, accountPassword: input(form, 'renew-password').value }); status('密码库已解锁。'); });
  } else {
    connection.append(text('已解锁 · ' + state.email, 'p', 'muted'));
    const controls = document.createElement('div'); controls.className = 'actions';
    controls.append(action('立即同步', async () => { await request('SYNC_NOW'); status('同步完成。'); await refresh(); }), action('锁定', async () => { await request('LOCK_VAULT'); status('密码库已锁定。'); await refresh(); }));
    connection.append(controls);
    if (state.lastSync) connection.append(text('上次同步：' + new Date(state.lastSync).toLocaleTimeString(), 'small'));
    if (state.syncError) connection.append(text(state.syncError, 'p', 'error'));
    credentials.append(text('当前网站', 'h2'));
    if (!state.credentials.length) credentials.append(text('没有匹配的登录信息。', 'p', 'muted'));
    for (const item of state.credentials) {
      const row = document.createElement('div'); row.className = 'credential';
      row.append(text(item.title, 'strong'), text(item.username || '无用户名', 'small'));
      if (item.matchType === 'exact') { row.append(text('精确匹配 · HTTPS', 'small'), action('填充', async () => { await request('FILL_MATCHED_CREDENTIAL', { credentialId: item.id }); status('已填充，尚未提交登录。'); })); }
      else row.append(text(item.matchType === 'similar' ? '相似域名，已阻止填充。' : '可疑域名，已阻止填充。', 'p', 'error'));
      if (item.matchType === 'exact' && item.hasTotp) row.append(action('复制验证码', async () => { const result = await request('GET_TOTP_CODE', { credentialId: item.id }); await navigator.clipboard.writeText(result.code); status('验证码已复制。'); }));
      credentials.append(row);
    }
    if (state.conflicts.length) {
      conflicts.append(text('需要处理的同步冲突', 'h2'));
      for (const item of state.conflicts) {
        const row = document.createElement('div'); row.className = 'credential'; row.append(text(item.title, 'strong'));
        const controls = document.createElement('div'); controls.className = 'actions';
        for (const [label, choice] of [['保留本地', 'local'], ['采用云端', 'remote'], ['另存副本', 'copy']] as const) controls.append(action(label, async () => { await request('RESOLVE_CONFLICT', { itemId: item.id, choice }); status('冲突已处理。'); await refresh(); }));
        row.append(controls); conflicts.append(row);
      }
    }
  }
  await renderPending(state.pending);
}
function regenerate() {
  try {
    generated.value = generatePassword({ length: Number((document.getElementById('length') as HTMLInputElement).value), includeUpper: (document.getElementById('upper') as HTMLInputElement).checked, includeLower: (document.getElementById('lower') as HTMLInputElement).checked, includeDigits: (document.getElementById('digits') as HTMLInputElement).checked, includeSymbols: (document.getElementById('symbols') as HTMLInputElement).checked });
    status('密码已生成。');
  } catch { generated.value = ''; status('请选择至少一种字符，长度需要为 8–128 位。', true); }
}
document.getElementById('regenerate')!.addEventListener('click', regenerate);
for (const id of ['length', 'upper', 'lower', 'digits', 'symbols']) document.getElementById(id)!.addEventListener('change', regenerate);
document.getElementById('copy')!.addEventListener('click', async () => {
  try { if (!generated.value) return; await navigator.clipboard.writeText(generated.value); status('密码已复制。'); }
  catch { generated.focus(); generated.select(); status('无法访问剪贴板，请手动复制所选密码。', true); }
});
document.getElementById('use-generated')!.addEventListener('click', async event => {
  if (!event.isTrusted || !generated.value) return;
  try { await request('FILL_GENERATED_PASSWORD', { password: generated.value }); status('已填入密码，尚未提交。'); }
  catch (error) { status(error instanceof Error ? error.message : '无法填充，请复制后手动输入。', true); }
});
regenerate();
void refresh().catch(error => status(error instanceof Error ? error.message : '插件加载失败。', true));
api.storage.onChanged.addListener((_changes, area) => { if (area === 'local') void refresh().catch(() => undefined); });
