/**
 * Clipboard utility for the desktop app.
 *
 * Uses @tauri-apps/plugin-clipboard-manager when available (Tauri runtime),
 * falls back to navigator.clipboard for development in browser.
 */

let tauriClipboard: {
  writeText: (text: string) => Promise<void>;
} | null = null;

// Lazy-load the Tauri clipboard plugin — only works inside Tauri runtime
async function getTauriClipboard() {
  if (tauriClipboard) return tauriClipboard;
  try {
    const mod = await import("@tauri-apps/plugin-clipboard-manager");
    tauriClipboard = mod;
    return mod;
  } catch {
    return null;
  }
}

let toastCallback: ((message: string) => void) | null = null;

/**
 * Register a toast callback that will be called after successful copy.
 * The App shell should call this once at mount.
 */
export function registerClipboardToast(callback: (message: string) => void): void {
  toastCallback = callback;
}

/**
 * Copy text to clipboard and show a toast.
 *
 * Prefers Tauri native clipboard; falls back to Web Clipboard API.
 * Shows a security reminder toast after copying.
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    const tauri = await getTauriClipboard();
    if (tauri) {
      await tauri.writeText(text);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      throw new Error("剪贴板不可用");
    }

    toastCallback?.("已复制，建议尽快粘贴并清除剪贴板");
  } catch {
    // Last resort: try execCommand fallback
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toastCallback?.("已复制，建议尽快粘贴并清除剪贴板");
    } catch {
      toastCallback?.("复制失败");
    }
  }
}
