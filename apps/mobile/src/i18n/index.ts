import { useCallback, useMemo, useSyncExternalStore } from "react";
import { chineseOverrides, englishCatalog } from "./catalog";

export type AppLanguage = "zh" | "en";
export type TranslationParams = Readonly<Record<string, string | number>>;

let currentLanguage: AppLanguage = "zh";
const listeners = new Set<() => void>();

const englishPatterns: ReadonlyArray<readonly [RegExp, (...values: string[]) => string]> = [
  [/^待同步 (\d+) 项$/u, (count) => `${count} pending`],
  [/^处理 (\d+) 个冲突$/u, (count) => `Resolve ${count} conflicts`],
  [/^处理 (\d+) 个同步冲突$/u, (count) => `Resolve ${count} sync conflicts`],
  [/^处理同步冲突，当前 (\d+) 条$/u, (count) => `Resolve sync conflicts, ${count} current`],
  [/^(\d+) 条等待处理　?›$/u, (count) => `${count} awaiting resolution ›`],
  [/^检测到 (\d+) 个冲突$/u, (count) => `${count} conflicts detected`],
  [/^版本 (\d+)$/u, (revision) => `Version ${revision}`],
  [/^恢复历史版本 (\d+)$/u, (revision) => `Restore version ${revision}`],
  [/^(.+)（本地副本）$/u, (title) => `${title} (local copy)`],
  [/^打开条目 (.+)$/u, (title) => `Open item ${title}`],
  [/^编辑 (.+)$/u, (title) => `Edit ${title}`],
  [/^设备 (.+)$/u, (name) => `Device ${name}`],
  [/^批准设备 (.+)$/u, (name) => `Approve device ${name}`],
  [/^拒绝设备 (.+)$/u, (name) => `Reject device ${name}`],
  [/^撤销设备 (.+)$/u, (name) => `Revoke device ${name}`],
  [/^(\d+) 分钟$/u, (minutes) => `${minutes} minutes`],
  [/^(\d+) 位$/u, (length) => `${length} characters`],
  [/^已安全导入 (\d+) 个条目；它们已进入离线同步队列。$/u,
    (count) => `${count} items were imported securely and queued for offline sync.`],
  [/^已复制(.+)，未被替换时将在 30 秒后清除$/u,
    (label) => `${label} copied; it will be cleared after 30 seconds unless replaced.`],
  [/^版本 (\d+) 会作为一次新的修改进入同步队列，当前版本仍保留在云端历史中。$/u,
    (revision) => `Version ${revision} will be queued as a new change; the current version remains in cloud history.`],
  [/^仅在另一台设备上核对过以下指纹后继续：\s*(.+)\s*批准后会为该设备加密分发密码库密钥。$/su,
    (fingerprint) => `Continue only after verifying this fingerprint on another device:\n\n${fingerprint}\n\nApproval encrypts and distributes the vault key to this device.`],
  [/^“(.+)”将无法获取密码库密钥。此操作不能在本页撤销。$/u,
    (name) => `“${name}” will not receive the vault key. This cannot be undone on this screen.`],
  [/^“(.+)”的移动会话和后续同步权限将被撤销。已离线的数据不会被远程擦除。$/u,
    (name) => `The mobile session and future sync access for “${name}” will be revoked. Offline data cannot be erased remotely.`],
];

function emitLanguageChange() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function interpolate(value: string, params?: TranslationParams): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/gu, (match, name: string) => {
    const replacement = params[name];
    return replacement === undefined ? match : String(replacement);
  });
}

export function humanizeRouteSlug(key: string): string | undefined {
  if (!/^[a-z0-9()[\]/_-]+$/iu.test(key)) return undefined;
  const words = key
    .split("/")
    .filter((part) => !/^\[[^\]]+\]$/u.test(part))
    .join(" ")
    .replace(/[()]/gu, " ")
    .trim()
    .split(/[-_\s]+/u)
    .filter(Boolean);
  if (words.length === 0) return "Screen";
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(" ");
}

function translateEnglish(key: string): string {
  const exact = englishCatalog[key];
  if (exact !== undefined) return exact;

  for (const [pattern, format] of englishPatterns) {
    const match = pattern.exec(key);
    if (match) return format(...match.slice(1));
  }

  return key;
}

export function resolveLanguage(value: string | null | undefined): AppLanguage {
  return value?.toLowerCase().startsWith("en") ? "en" : "zh";
}

export function getLanguage(): AppLanguage {
  return currentLanguage;
}

export function localeForLanguage(language: AppLanguage = currentLanguage): "zh-CN" | "en-US" {
  return language === "en" ? "en-US" : "zh-CN";
}

export function setLanguage(language: AppLanguage): void {
  if (language === currentLanguage) return;
  currentLanguage = language;
  emitLanguageChange();
}

export function translate(
  key: string,
  params?: TranslationParams,
  language: AppLanguage = currentLanguage,
): string {
  const translated = language === "en"
    ? translateEnglish(key)
    : (chineseOverrides[key] ?? key);
  return interpolate(translated, params);
}

export const t = translate;

/**
 * Route names are application metadata, never user data. Keep slug humanizing
 * behind this dedicated API so generic translations cannot mutate usernames,
 * recovery codes, passwords, or vault fields that happen to resemble a slug.
 */
export function translateRouteName(
  routeName: string,
  language: AppLanguage = currentLanguage,
): string {
  const translated = translate(routeName, undefined, language);
  if (translated !== routeName) return translated;
  return language === "en" ? (humanizeRouteSlug(routeName) ?? routeName) : routeName;
}

export function translateVisibleText(value: string, language: AppLanguage = currentLanguage): string {
  const key = value.replace(/\s+/gu, " ").trim();
  if (!key) return value;

  const translated = translate(key, undefined, language);
  if (translated === key) return value;

  const originalLeading = value.match(/^\s*/u)?.[0] ?? "";
  const originalTrailing = value.match(/\s*$/u)?.[0] ?? "";
  const leading = /^\s/u.test(translated) ? "" : originalLeading;
  const trailing = /\s$/u.test(translated) ? "" : originalTrailing;
  return `${leading}${translated}${trailing}`;
}

export function useI18n() {
  const language = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  const translateForLanguage = useCallback(
    (key: string, params?: TranslationParams) => translate(key, params, language),
    [language],
  );

  return useMemo(() => ({
    language,
    setLanguage,
    t: translateForLanguage,
  }), [language, translateForLanguage]);
}
