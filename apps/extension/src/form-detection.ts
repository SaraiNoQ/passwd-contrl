import type { FormCandidate } from "./messages";

export const isVisibleInput = (input: HTMLInputElement): boolean => {
  if (input.type === "hidden" || input.disabled || input.readOnly) {
    return false;
  }

  const rect = input.getBoundingClientRect();
  const style = window.getComputedStyle(input);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
};

export const safeFieldId = (input: HTMLInputElement): string => {
  if (!input.dataset.zeroVaultFieldId) {
    input.dataset.zeroVaultFieldId = crypto.randomUUID();
  }

  return input.dataset.zeroVaultFieldId;
};

/**
 * Check if an element is inside a cross-origin iframe.
 * Returns true if the element is in the top document or a same-origin iframe.
 * Returns false if the element is in a cross-origin iframe.
 */
const isSameOriginFrame = (element: Element): boolean => {
  try {
    // Walk up the frame hierarchy. If we can access parent.document, it's same-origin.
    let current: Element | Document = element;
    while (current.ownerDocument?.defaultView?.frameElement) {
      // Accessing frameElement on a cross-origin frame throws
      const frameEl: Element = current.ownerDocument.defaultView.frameElement;
      if (!frameEl) break;
      // Try to access the parent document - this throws for cross-origin
      void frameEl.ownerDocument?.defaultView?.document;
      current = frameEl;
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Enhanced username field detection using autocomplete attribute, type, name, and id patterns.
 */
const USERNAME_SELECTORS = [
  "input[autocomplete='username']",
  "input[autocomplete='email']",
  "input[type='email']",
  "input[name='username']",
  "input[name='user']",
  "input[name='login']",
  "input[name='email']",
  "input[id='username']",
  "input[id='user']",
  "input[id='login']",
  "input[id='email']",
  "input[type='text']"
];

export const detectForms = (): FormCandidate[] => {
  if (window.location.protocol !== "https:") {
    return [];
  }

  // Skip if the current document is inside a cross-origin iframe
  if (!isSameOriginFrame(document.documentElement)) {
    return [];
  }

  const candidates: FormCandidate[] = [];

  for (const form of Array.from(document.forms)) {
    // Skip forms inside cross-origin iframes
    if (!isSameOriginFrame(form)) {
      continue;
    }

    const password = Array.from(form.querySelectorAll<HTMLInputElement>("input[type='password']")).find(isVisibleInput);
    if (!password) {
      continue;
    }

    // Try multiple selectors for username field, in priority order
    let username: HTMLInputElement | null = null;
    for (const selector of USERNAME_SELECTORS) {
      const found = Array.from(form.querySelectorAll<HTMLInputElement>(selector)).find(isVisibleInput);
      if (found) {
        username = found;
        break;
      }
    }

    candidates.push(
      username
        ? { usernameFieldId: safeFieldId(username), passwordFieldId: safeFieldId(password) }
        : { passwordFieldId: safeFieldId(password) }
    );
  }

  return candidates;
};
