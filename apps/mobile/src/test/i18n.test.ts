import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  getLanguage,
  localeForLanguage,
  resolveLanguage,
  setLanguage,
  t,
  translateRouteName,
  translateVisibleText,
} from "../i18n";
import { englishCatalog } from "../i18n/catalog";

function quotedChineseText(source: string): string[] {
  return [...source.matchAll(/"([^"\n]*\p{Script=Han}[^"\n]*)"/gu)]
    .map((match) => match[1] === undefined
      ? undefined
      : JSON.parse(`"${match[1]}"`) as string)
    .filter((value): value is string => value !== undefined);
}

function literalTranslationKeys(source: string): string[] {
  return [...source.matchAll(/\bt\("([^"\n]+)"/gu)]
    .map((match) => match[1])
    .filter((value): value is string => value !== undefined);
}

afterEach(() => setLanguage("zh"));

describe("mobile i18n", () => {
  it("defaults to Chinese and switches the same source text to English", () => {
    expect(getLanguage()).toBe("zh");
    expect(t("创建账户")).toBe("创建账户");

    setLanguage("en");
    expect(t("创建账户")).toBe("Create account");
    expect(translateVisibleText("  输入主密码  ")).toBe("  Enter master password  ");
  });

  it("translates dynamic visible labels without changing their values", () => {
    setLanguage("en");
    expect(t("待同步 3 项")).toBe("3 pending");
    expect(t("5 分钟")).toBe("5 minutes");
    expect(t("20 位")).toBe("20 characters");
    expect(t("打开条目 GitHub")).toBe("Open item GitHub");
    expect(t("GitHub（本地副本）")).toBe("GitHub (local copy)");
    expect(t("版本 {revision}", { revision: 7 }, "en")).toBe("Version 7");
  });

  it("keeps unknown copy and user-shaped ASCII values byte-for-byte intact", () => {
    expect(t("开发期新提示")).toBe("开发期新提示");

    setLanguage("en");
    expect(t("开发期新提示")).toBe("开发期新提示");
    expect(t("future-screen")).toBe("future-screen");
    expect(t("future-screen/[id]")).toBe("future-screen/[id]");
    expect(t("6pLu6vV0H53yL-CzlfdjYRGj6C5_rTIKbtAiJF4o2O4")).toBe(
      "6pLu6vV0H53yL-CzlfdjYRGj6C5_rTIKbtAiJF4o2O4",
    );
    expect(t("john_doe")).toBe("john_doe");
    expect(t("(tabs)")).toBe("Vault");
    expect(translateRouteName("future-screen/[id]")).toBe("Future Screen");
    expect(translateRouteName("recovery-code")).toBe("Recovery code");
  });

  it("normalizes supported language values", () => {
    expect(resolveLanguage("en-US")).toBe("en");
    expect(resolveLanguage("zh-CN")).toBe("zh");
    expect(resolveLanguage(undefined)).toBe("zh");
    expect(localeForLanguage("zh")).toBe("zh-CN");
    expect(localeForLanguage("en")).toBe("en-US");
  });

  it("covers every exact route title and auth/vault state message in English", () => {
    const rootLayout = readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8");
    const tabsLayout = readFileSync(new URL("../../app/(tabs)/_layout.tsx", import.meta.url), "utf8");
    const routeTitles = [rootLayout, tabsLayout]
      .flatMap((source) => [...source.matchAll(/title:\s*t\("([^"]+)"\)/gu)])
      .map((match) => match[1])
      .filter((value): value is string => value !== undefined);
    const stateMessages = [
      "../state/auth-state.ts",
      "../state/vault-state.ts",
    ].flatMap((path) => quotedChineseText(
      readFileSync(new URL(path, import.meta.url), "utf8"),
    ));

    expect([...new Set([...routeTitles, ...stateMessages])]
      .filter((key) => englishCatalog[key] === undefined)).toEqual([]);
  });

  it("does not expose native protocol constants as Chinese UI labels", () => {
    const settings = readFileSync(
      new URL("../screens/SettingsScreen.tsx", import.meta.url),
      "utf8",
    );
    expect(settings).not.toContain("READY · 已解锁");
    expect(settings).not.toContain("LOCKED_BIOMETRIC · 填充时验证");
    expect(settings).not.toContain("UNAVAILABLE · 尚未安全配置");
    expect(settings).not.toContain(">Credential Provider<");
    expect(settings).not.toContain("BIOMETRIC_STRONG 密钥");
  });

  it("never auto-translates Typography children or input props", () => {
    const typography = readFileSync(
      new URL("../components/Typography.tsx", import.meta.url),
      "utf8",
    );
    expect(typography).not.toContain("translateVisibleText");
    expect(typography).not.toContain("localizeChildren");
    expect(typography).toContain("{children}");
    expect(typography).toContain("placeholder={placeholder}");
  });

  it("renders critical vault and recovery values without sending them through i18n", () => {
    const sources = [
      "../screens/RecoveryCodeScreen.tsx",
      "../screens/RecoveryScreen.tsx",
      "../screens/CredentialDetailScreen.tsx",
      "../screens/VaultListScreen.tsx",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");

    for (const unsafeCall of [
      "t(registrationRecoveryCode)",
      "t(rotatedCode)",
      "t(item.username)",
      "t(item.password)",
      "t(item.noteBody)",
      "t(item.cardNumber)",
      "t(field.name)",
      "t(field.value)",
    ]) {
      expect(sources).not.toContain(unsafeCall);
    }
  });

  it("keeps all screen copy explicit while preserving user-entered values", () => {
    const screenDirectory = new URL("../screens/", import.meta.url);
    const allScreenAndLayoutSources = [
      ...readdirSync(screenDirectory)
        .filter((filename) => filename.endsWith(".tsx"))
        .map((filename) => readFileSync(new URL(filename, screenDirectory), "utf8")),
      readFileSync(new URL("../../app/_layout.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../../app/(tabs)/_layout.tsx", import.meta.url), "utf8"),
    ];
    const settings = readFileSync(
      new URL("../screens/SettingsScreen.tsx", import.meta.url),
      "utf8",
    );
    const unlock = readFileSync(
      new URL("../screens/UnlockScreen.tsx", import.meta.url),
      "utf8",
    );
    const editor = readFileSync(
      new URL("../screens/VaultItemEditorScreen.tsx", import.meta.url),
      "utf8",
    );
    const missingKeys = [...new Set(allScreenAndLayoutSources.flatMap(literalTranslationKeys))]
      .filter((key) => englishCatalog[key] === undefined);

    expect(missingKeys).toEqual([]);
    for (const source of allScreenAndLayoutSources) {
      expect(source).not.toMatch(/>\s*\p{Script=Han}[^<{]*</u);
      expect(source).not.toMatch(/placeholder="[^"]*\p{Script=Han}/u);
      expect(source).not.toMatch(/Alert\.alert\(\s*"[^"]*\p{Script=Han}/u);
    }

    expect(settings).not.toContain("t(user.email)");
    for (const unsafeCall of [
      "t(form.title)",
      "t(form.folder)",
      "t(form.origin)",
      "t(form.username)",
      "t(form.password)",
      "t(form.totp)",
      "t(form.noteBody)",
      "t(form.cardholderName)",
      "t(form.cardNumber)",
      "t(form.brand)",
      "t(form.notes)",
      "t(entry.name)",
      "t(entry.value)",
    ]) {
      expect(editor).not.toContain(unsafeCall);
    }
  });

  it("localizes device and conflict UI without translating security or vault data", () => {
    const sources = [
      "../screens/DeviceApprovalScreen.tsx",
      "../screens/DevicesScreen.tsx",
      "../screens/ConflictsScreen.tsx",
    ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
    const missingKeys = [...new Set(sources.flatMap(quotedChineseText))]
      .filter((key) => englishCatalog[key] === undefined);

    expect(missingKeys).toEqual([]);
    for (const source of sources) {
      expect(source).not.toMatch(/>\s*\p{Script=Han}[^<{]*</u);
      expect(source).not.toMatch(/accessibilityLabel="[^"]*\p{Script=Han}/u);
      expect(source).not.toMatch(/Alert\.alert\(\s*"[^"]*\p{Script=Han}/u);
    }

    const combined = sources.join("\n");
    for (const unsafeCall of [
      "t(target.name)",
      "t(trustedDevice.name)",
      "t(target.fingerprint)",
      "t(trustedDevice.fingerprint)",
      "t(conflict.itemId)",
      "t(summary.title)",
      "t(summary.folder)",
      "t(summary.origin)",
      "t(summary.username)",
      "t(summary.cardholderName)",
      "t(summary.brand)",
      "t(summary.cardLastFour)",
    ]) {
      expect(combined).not.toContain(unsafeCall);
    }

    const deviceName = "Pixel_9-Pro/张三";
    const fingerprint = "AA:BB:CC:DD";
    expect(t("设备 {name}", { name: deviceName }, "en")).toBe(`Device ${deviceName}`);
    expect(t("本机设备指纹：{fingerprint}", { fingerprint }, "en"))
      .toBe(`Device fingerprint: ${fingerprint}`);
    expect(t("条目 ID：{id}", { id: "vault_item-01" }, "en"))
      .toBe("Item ID: vault_item-01");
  });
});
