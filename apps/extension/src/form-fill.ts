import { detectForms, isVisibleInput } from "./form-detection";
import type { FillCredentialMessage } from "./messages";

export const setNativeValue = (input: HTMLInputElement, value: string) => {
  input.focus();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
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
  if (input.disabled || input.readOnly || input.type === "hidden") {
    console.log("[Zero Vault] Field rejected: disabled, readonly, or hidden", input);
    return false;
  }

  const rect = input.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    console.log("[Zero Vault] Field rejected: zero dimensions", input);
    return false;
  }

  const style = window.getComputedStyle(input);
  if (style.visibility === "hidden" || style.display === "none") {
    console.log("[Zero Vault] Field rejected: not visible", input);
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
    console.log("[Zero Vault] Field rejected: cross-origin iframe", input);
    return false;
  }

  return true;
};

export const fillFirstDetectedForm = (message: FillCredentialMessage): boolean => {
  if (message.type !== "FILL_CREDENTIAL" || window.location.protocol !== "https:") {
    console.log("[Zero Vault] Fill rejected: not HTTPS or wrong message type");
    return false;
  }

  console.log("[Zero Vault] Attempting fill on", window.location.origin);

  const candidates = detectForms();
  const first = candidates[0];
  if (!first) {
    console.log("[Zero Vault] No form candidates found");
    return false;
  }

  const password = document.querySelector<HTMLInputElement>(
    `input[data-zero-vault-field-id="${first.passwordFieldId}"]`
  );
  const username = first.usernameFieldId
    ? document.querySelector<HTMLInputElement>(`input[data-zero-vault-field-id="${first.usernameFieldId}"]`)
    : null;

  // Re-verify field safety before filling
  if (!password || !isSafeToFill(password)) {
    console.log("[Zero Vault] Password field not safe to fill");
    return false;
  }

  if (username && message.username && isSafeToFill(username)) {
    console.log("[Zero Vault] Filling username field");
    setNativeValue(username, message.username);
  }

  console.log("[Zero Vault] Filling password field");
  setNativeValue(password, message.password);
  return true;
};
