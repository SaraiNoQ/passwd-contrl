import { detectForms, isVisibleInput } from "./form-detection";
import type { FillCredentialMessage } from "./messages";

export const setNativeValue = (input: HTMLInputElement, value: string) => {
  const type = input.type; const form = input.form; const purpose = input.autocomplete; const name = input.name; const id = input.id;
  input.focus();
  // Focus handlers run synchronously in the website and can mutate the target.
  if (!isSafeToFill(input) || input.type !== type || input.form !== form || input.autocomplete !== purpose || input.name !== name || input.id !== id) return false;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
};

/**
 * Re-verify that a field is safe to fill:
 * - not disabled
 * - not readonly
 * - not hidden (type="hidden")
 * - visible (has dimensions, not display:none or visibility:hidden)
 * - in a same-origin context
 */
export const isSafeToFill = (input: HTMLInputElement): boolean => {
  if (!isVisibleInput(input)) return false;
  if (input.disabled || input.readOnly || input.type === "hidden") {
    return false;
  }

  const rect = input.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return false;
  }

  const style = window.getComputedStyle(input);
  if (style.visibility === "hidden" || style.display === "none") {
    return false;
  }

  // Check same-origin frame context
  try {
    let current: Element | Document = input;
    while (current.ownerDocument?.defaultView?.frameElement) {
      const frameEl: Element = current.ownerDocument.defaultView.frameElement;
      if (!frameEl) break;
      void frameEl.ownerDocument?.defaultView?.document;
      current = frameEl;
    }
  } catch {
    return false;
  }

  return true;
};

export const fillFirstDetectedForm = (message: FillCredentialMessage): boolean => {
  if (message.type !== "FILL_CREDENTIAL" || window.location.protocol !== "https:") {
    return false;
  }

  const candidates = detectForms();
  const first = candidates[0];
  if (!first) {
    return false;
  }

  const password = document.querySelector<HTMLInputElement>(
    `input[data-zero-vault-field-id="${first.passwordFieldId}"]`
  );
  const username = first.usernameFieldId
    ? document.querySelector<HTMLInputElement>(`input[data-zero-vault-field-id="${first.usernameFieldId}"]`)
    : null;

  // Re-verify field safety before filling
  if (!password || password.type !== 'password' || !password.form || !isSafeToFill(password)) {
    return false;
  }

  const form = password.form;
  if (username && username.form === form && message.username && isSafeToFill(username)) {
    if (!setNativeValue(username, message.username)) return false;
  }
  if (password.form !== form || password.type !== 'password') return false;
  return setNativeValue(password, message.password);
};
