import { api } from './browser-api';
import { detectForms, isVisibleInput, safeFieldId } from './form-detection';
import { fillFirstDetectedForm, setNativeValue, isSafeToFill } from './form-fill';
import type { FillCredentialMessage } from './messages';

const global = globalThis as typeof globalThis & { __zeroVaultContent?: boolean };
if (!global.__zeroVaultContent && window.top === window.self && location.protocol === 'https:') {
  global.__zeroVaultContent = true;
  const documentId = crypto.randomUUID();
  let pending: { id: string; form: HTMLFormElement } | undefined;
  let prompt: HTMLIFrameElement | undefined;
  const send = (message: unknown) => api.runtime.sendMessage(message).catch(() => undefined);
  const showPrompt = (reply: { id?: string } | undefined) => {
    if (!reply?.id) return;
    prompt?.remove();
    const frame = document.createElement('iframe');
    frame.src = api.runtime.getURL('save-prompt.html') + '?candidate=' + encodeURIComponent(reply.id);
    frame.title = 'Zero Vault 保存登录信息';
    frame.dataset.zeroVaultPrompt = reply.id;
    frame.style.cssText = 'position:fixed!important;top:16px!important;right:16px!important;width:340px!important;max-width:calc(100vw - 32px)!important;height:280px!important;border:0!important;border-radius:12px!important;z-index:2147483647!important;box-shadow:0 8px 32px rgba(0,0,0,.24)!important;color-scheme:dark!important;';
    document.documentElement.append(frame); prompt = frame;
  };
  window.addEventListener('message', event => {
    if (event.source === prompt?.contentWindow && event.data?.type === 'ZERO_VAULT_PROMPT_CLOSED') { prompt?.remove(); prompt = undefined; }
  });
  const capture = async (form: HTMLFormElement) => {
    const candidate = detectForms().find(c => form.querySelector('input[data-zero-vault-field-id="' + c.passwordFieldId + '"]'));
    if (!candidate) return;
    const passwords = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(isVisibleInput);
    if (passwords.length !== 1 || passwords[0]!.autocomplete === 'new-password' || passwords[0]!.autocomplete === 'one-time-code') return;
    const password = passwords[0]!;
    if (!password.value) return;
    const username = candidate.usernameFieldId ? form.querySelector<HTMLInputElement>('input[data-zero-vault-field-id="' + candidate.usernameFieldId + '"]')?.value ?? '' : '';
    const reply = await send({ type: 'CAPTURE_LOGIN', input: { document: documentId, username, password: password.value } });
    if (reply?.id) { pending = { id: reply.id, form }; await checkResult(); }
  };
  const checkResult = async () => {
    if (pending && (!pending.form.isConnected || !Array.from(pending.form.querySelectorAll<HTMLInputElement>('input[type="password"]')).some(isVisibleInput))) {
      const id = pending.id; pending = undefined;
      showPrompt(await send({ type: 'LOGIN_FORM_GONE', id, document: documentId }));
    }
  };
  document.addEventListener('submit', event => {
    if (event.isTrusted && event.target instanceof HTMLFormElement) void capture(event.target);
  }, true);
  // Some SPA forms handle a trusted submit-button click without dispatching submit.
  document.addEventListener('click', event => {
    if (!event.isTrusted || !(event.target instanceof Element)) return;
    const button = event.target.closest<HTMLButtonElement | HTMLInputElement>('button,input[type="submit"]');
    if (button?.form && button.type === 'submit') void capture(button.form);
  }, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(() => void checkResult(), 150); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'hidden', 'class'] });
  api.runtime.onMessage.addListener((raw: FillCredentialMessage | { type: 'FILL_GENERATED_PASSWORD'; origin: string; password: string }, sender, reply) => {
    if (sender.id !== api.runtime.id || raw.origin !== location.origin || window.top !== window.self) { reply({ ok: false }); return false; }
    if (raw.type === 'FILL_CREDENTIAL') { reply({ ok: fillFirstDetectedForm(raw) }); return false; }
    if (raw.type === 'FILL_GENERATED_PASSWORD' && typeof raw.password === 'string' && raw.password.length >= 8 && raw.password.length <= 128) {
      const candidates = detectForms();
      const first = candidates[0];
      const target = first ? document.querySelector<HTMLInputElement>('input[data-zero-vault-field-id="' + first.passwordFieldId + '"]') : null;
      if (!target || !isSafeToFill(target)) { reply({ ok: false }); return false; }
      // Only a declared new-password form can fill more than one password field.
      const form = target.form; const newPassword = target.autocomplete === 'new-password';
      const fields = newPassword && form
        ? Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"][autocomplete="new-password"]'))
        : [target];
      if (!fields.every(isSafeToFill)) { reply({ ok: false }); return false; }
      for (const field of fields) {
        if (field.type !== 'password' || field.form !== form || (newPassword && field.autocomplete !== 'new-password') || !setNativeValue(field, raw.password)) { reply({ ok: false }); return false; }
      }
      reply({ ok: true }); return false;
    }
    reply({ ok: false }); return false;
  });
  void send({ type: 'PAGE_READY', document: documentId }).then(showPrompt);
}
