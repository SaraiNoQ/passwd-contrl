import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Alert, AppState, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  totpUriSchema,
  vaultItemSchema,
  type AndroidAssociation,
  type CustomField,
  type VaultItem,
  type VaultItemType,
} from "@zero-vault/shared";
import {
  listNativeInstalledApps,
  type NativeInstalledApp,
} from "@zero-vault/zero-vault-native";
import { useVaultState } from "../state/app-state";
import { collectExistingFolders } from "../lib/folder-suggestions";
import { fontSize, fontWeight, minTouchTarget, radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";

type FormState = {
  type: VaultItemType;
  title: string;
  folder: string;
  notes: string;
  originProtocol: "https" | "http";
  origin: string;
  username: string;
  password: string;
  totp: string;
  noteBody: string;
  cardholderName: string;
  cardNumber: string;
  expirationMonth: string;
  expirationYear: string;
  cvv: string;
  brand: string;
  customFields: CustomField[];
  androidAssociations: AndroidAssociation[];
};

const EMPTY_FORM: FormState = {
  type: "login", title: "", folder: "", notes: "", originProtocol: "https", origin: "", username: "", password: "", totp: "",
  noteBody: "", cardholderName: "", cardNumber: "", expirationMonth: "", expirationYear: "", cvv: "", brand: "", customFields: [], androidAssociations: [],
};

function splitOrigin(value: string): Pick<FormState, "originProtocol" | "origin"> {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return {
        originProtocol: url.protocol === "http:" ? "http" : "https",
        origin: url.host,
      };
    }
  } catch {
    // Keep malformed legacy values editable instead of silently discarding them.
  }
  return {
    originProtocol: "https",
    origin: value.replace(/^https?:\/\//iu, ""),
  };
}

function formFromItem(item?: VaultItem): FormState {
  if (!item) return EMPTY_FORM;
  const base = { ...EMPTY_FORM, type: item.type, title: item.title, folder: item.folder, notes: item.notes, customFields: item.customFields };
  if (item.type === "login") {
    return {
      ...base,
      ...splitOrigin(item.origin),
      username: item.username,
      password: item.password,
      totp: item.totp ?? "",
      androidAssociations: item.androidAssociations ?? [],
    };
  }
  if (item.type === "secure_note") return { ...base, noteBody: item.noteBody };
  return {
    ...base,
    cardholderName: item.cardholderName,
    cardNumber: item.cardNumber,
    expirationMonth: item.expirationMonth,
    expirationYear: item.expirationYear,
    cvv: item.cvv,
    brand: item.brand,
  };
}

function normalizeOrigin(protocol: "https" | "http", value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  let url: URL;
  try {
    url = new URL(`${protocol}://${trimmed}`);
  } catch {
    throw new Error("网站必须是没有路径、查询或账号信息的 HTTP(S) origin");
  }
  if (
    url.protocol !== `${protocol}:` ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "" && url.pathname !== "/")
  ) {
    throw new Error("网站必须是没有路径、查询或账号信息的 HTTP(S) origin");
  }
  return url.origin;
}

export function VaultItemEditorScreen({ itemId }: { itemId?: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { t } = useI18n();
  const {
    items,
    saveItem,
    createItemId,
    generatePassword,
    generateTotp,
    isLocked,
    isLoading,
  } = useVaultState();
  const existing = useMemo(() => items.find((item) => item.id === itemId), [itemId, items]);
  const existingFolders = useMemo(() => collectExistingFolders(items), [items]);
  const [form, setForm] = useState<FormState>(() => formFromItem(existing));
  const [saving, setSaving] = useState(false);
  const [installedApps, setInstalledApps] = useState<NativeInstalledApp[]>([]);
  const [installedAppPickerVisible, setInstalledAppPickerVisible] = useState(false);
  const [installedAppsLoading, setInstalledAppsLoading] = useState(false);
  const [originProtocolMenuOpen, setOriginProtocolMenuOpen] = useState(false);
  const [generatorOptions, setGeneratorOptions] = useState({
    length: 20,
    upper: true,
    lower: true,
    digits: true,
    symbols: true,
  });
  const editorActiveRef = useRef(true);

  useEffect(() => {
    editorActiveRef.current = true;
    return () => {
      editorActiveRef.current = false;
    };
  }, []);

  const exitEditor = useCallback(() => {
    editorActiveRef.current = false;
    setInstalledAppPickerVisible(false);
    setInstalledApps([]);
    setForm(EMPTY_FORM);
    router.replace(itemId ? `/credential/${itemId}` : "/(tabs)/vault");
  }, [itemId, router]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") exitEditor();
    });
    return () => subscription.remove();
  }, [exitEditor]);

  useEffect(() => {
    if (isLocked) exitEditor();
  }, [exitEditor, isLocked]);

  const field = useCallback((key: keyof FormState, value: FormState[keyof FormState]) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);

  const updateOrigin = useCallback((value: string) => {
    const pastedUrl = value.match(/^\s*(https?):\/\/(.*)$/iu);
    setForm((current) => ({
      ...current,
      ...(pastedUrl?.[1]
        ? { originProtocol: pastedUrl[1].toLowerCase() === "http" ? "http" as const : "https" as const }
        : {}),
      origin: pastedUrl?.[2] ?? value,
    }));
  }, []);

  const openInstalledAppPicker = useCallback(async () => {
    if (installedAppsLoading) return;
    setInstalledAppPickerVisible(true);
    setInstalledAppsLoading(true);
    try {
      const apps = await listNativeInstalledApps();
      if (editorActiveRef.current) setInstalledApps(apps);
    } catch {
      if (editorActiveRef.current) {
        setInstalledAppPickerVisible(false);
        Alert.alert(
          t("无法读取已安装 App"),
          t("Android 未能安全读取可关联应用列表，请稍后重试。"),
        );
      }
    } finally {
      if (editorActiveRef.current) setInstalledAppsLoading(false);
    }
  }, [installedAppsLoading, t]);

  const selectInstalledApp = useCallback((app: NativeInstalledApp) => {
    const association = {
      packageName: app.packageName,
      signingCertificateSha256: app.signingCertificateSha256,
    };
    setForm((current) => {
      const samePackageIndex = current.androidAssociations.findIndex(
        (entry) => entry.packageName.trim() === app.packageName,
      );
      if (samePackageIndex >= 0) {
        const existingAssociation = current.androidAssociations[samePackageIndex];
        const samePackageCount = current.androidAssociations.filter(
          (entry) => entry.packageName.trim() === app.packageName,
        ).length;
        if (
          samePackageCount === 1 &&
          existingAssociation?.signingCertificateSha256
            .replace(/[^A-Fa-f0-9]/gu, "")
            .toUpperCase() === app.signingCertificateSha256
        ) {
          return current;
        }
        return {
          ...current,
          androidAssociations: current.androidAssociations.flatMap((entry, index) => {
            if (entry.packageName.trim() !== app.packageName) return [entry];
            return index === samePackageIndex ? [association] : [];
          }),
        };
      }

      const emptyAssociationIndex = current.androidAssociations.findIndex(
        (entry) => !entry.packageName.trim() && !entry.signingCertificateSha256.trim(),
      );
      if (emptyAssociationIndex >= 0) {
        return {
          ...current,
          androidAssociations: current.androidAssociations.map((entry, index) =>
            index === emptyAssociationIndex ? association : entry),
        };
      }
      return {
        ...current,
        androidAssociations: [...current.androidAssociations, association],
      };
    });
    setInstalledAppPickerVisible(false);
  }, []);

  const save = useCallback(async () => {
    if (!editorActiveRef.current) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const id = existing?.id ?? await createItemId();
      const rawTotp = form.totp.trim();
      const parsedTotp = rawTotp ? totpUriSchema.safeParse(rawTotp) : null;
      if (parsedTotp && !parsedTotp.success) {
        throw new Error("无效的 TOTP 密钥");
      }
      if (parsedTotp?.success) {
        // Keep the Rust parser as the final authority so unsupported HOTP,
        // algorithms, digits and periods cannot be saved as a silent dead field.
        await generateTotp(parsedTotp.data);
      }
      const common = {
        id,
        type: form.type,
        title: form.title.trim(),
        folder: form.folder.trim(),
        notes: form.notes,
        customFields: form.customFields.filter((entry) => entry.name.trim()).map((entry) => ({ ...entry, name: entry.name.trim() })),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      const candidate = form.type === "login"
        ? {
            ...common,
            type: "login" as const,
            origin: normalizeOrigin(form.originProtocol, form.origin),
            username: form.username,
            password: form.password,
            ...(parsedTotp?.success ? { totp: parsedTotp.data } : {}),
            ...(form.androidAssociations.length > 0
              ? {
                  androidAssociations: form.androidAssociations.map((association) => ({
                    packageName: association.packageName.trim(),
                    signingCertificateSha256: association.signingCertificateSha256
                      .replace(/[^A-Fa-f0-9]/gu, "")
                      .toUpperCase(),
                  })),
                }
              : {}),
          }
        : form.type === "secure_note"
          ? { ...common, type: "secure_note" as const, noteBody: form.noteBody }
          : {
              ...common,
              type: "credit_card" as const,
              cardholderName: form.cardholderName,
              cardNumber: form.cardNumber.replace(/\s/gu, ""),
              expirationMonth: form.expirationMonth,
              expirationYear: form.expirationYear,
              cvv: form.cvv,
              brand: form.brand,
            };
      const item = vaultItemSchema.parse(candidate);
      const saved = await saveItem(item);
      if (!editorActiveRef.current) return;
      if (saved) {
        editorActiveRef.current = false;
        if (existing) router.back();
        else router.replace(`/credential/${item.id}`);
      } else {
        Alert.alert(
          t("保存失败"),
          t("条目未能写入本机加密存储，未执行静默降级。请保持此页并重试。"),
        );
      }
    } catch (error) {
      const knownMessage = error instanceof Error && (
        error.message === "无效的 TOTP 密钥" ||
        error.message === "网站必须是没有路径、查询或账号信息的 HTTP(S) origin"
      )
        ? error.message
        : "条目内容无效";
      if (editorActiveRef.current) Alert.alert(t("无法保存"), t(knownMessage));
    } finally {
      if (editorActiveRef.current) setSaving(false);
    }
  }, [createItemId, existing, form, generateTotp, router, saveItem, t]);

  const createPassword = useCallback(async () => {
    const generated = await generatePassword(generatorOptions);
    field("password", generated);
  }, [field, generatePassword, generatorOptions]);

  const toggleGeneratorClass = useCallback((key: "upper" | "lower" | "digits" | "symbols") => {
    setGeneratorOptions((current) => {
      const enabledCount = [current.upper, current.lower, current.digits, current.symbols]
        .filter(Boolean).length;
      if (current[key] && enabledCount === 1) return current;
      return { ...current, [key]: !current[key] };
    });
  }, []);

  if (isLocked) {
    return <SafeAreaView style={styles.container} edges={["bottom"]}><View style={styles.center}><Text style={styles.muted}>{t("密码库已锁定")}</Text></View></SafeAreaView>;
  }

  if (itemId && !existing) {
    return <SafeAreaView style={styles.container} edges={["bottom"]}><View style={styles.center}><Text style={styles.muted}>{t("条目不存在或已被删除")}</Text></View></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!existing ? (
          <View style={styles.typeRow}>
            {(["login", "secure_note", "credit_card"] as const).map((type) => (
              <TouchableOpacity testID={`editor-type-${type}`} key={type} style={[styles.typeButton, form.type === type && styles.typeButtonActive]} onPress={() => field("type", type)}>
                <Text style={form.type === type ? styles.typeTextActive : styles.typeText}>
                  {type === "login" ? t("登录项") : type === "secure_note" ? t("安全笔记") : t("信用卡")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Input testID="editor-title" label={t("标题")} value={form.title} onChangeText={(value) => field("title", value)} autoCapitalize="sentences" />
        <View style={styles.folderField}>
          <Input
            testID="editor-folder"
            label={t("文件夹")}
            value={form.folder}
            onChangeText={(value) => field("folder", value)}
          />
          {existingFolders.length > 0 ? (
            <View testID="editor-folder-suggestions" style={styles.folderSuggestions}>
              <View style={styles.folderSuggestionHeader}>
                <Text style={styles.folderSuggestionTitle}>{t("已有文件夹")}</Text>
                <Text style={styles.folderSuggestionAction}>{t("点按即可填入")}</Text>
              </View>
              <ScrollView
                horizontal
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.folderSuggestionList}
              >
                {existingFolders.map((folder) => {
                  const selected = form.folder.trim() === folder;
                  return (
                    <TouchableOpacity
                      key={folder}
                      testID={`editor-folder-suggestion-${folder}`}
                      accessibilityRole="button"
                      accessibilityLabel={t("使用已有文件夹 {folder}", { folder })}
                      accessibilityState={{ selected }}
                      style={[
                        styles.folderSuggestion,
                        selected && styles.folderSuggestionSelected,
                      ]}
                      onPress={() => field("folder", folder)}
                    >
                      <SymbolView
                        name={{ ios: "folder", android: "folder", web: "folder" }}
                        size={16}
                        tintColor={selected ? colors.primaryContrast : colors.primary}
                      />
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.folderSuggestionText,
                          selected && styles.folderSuggestionTextSelected,
                        ]}
                      >
                        {folder}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          ) : null}
          <Text
            testID="editor-folder-hint"
            accessibilityLiveRegion="polite"
            style={styles.folderHint}
          >
            {form.folder.trim()
              ? existingFolders.includes(form.folder.trim())
                ? t("将保存到已有文件夹 {folder}", { folder: form.folder.trim() })
                : t("保存后将新建文件夹 {folder}", { folder: form.folder.trim() })
              : existingFolders.length > 0
                ? t("可输入新文件夹，或从已有文件夹中选择")
                : t("输入名称即可创建文件夹")}
          </Text>
        </View>

        {form.type === "login" ? (
          <>
            <View style={styles.inputGroup}>
              <View style={styles.labelRow}>
                <View style={styles.labelPixel} />
                <Text style={styles.label}>{t("网站")}</Text>
              </View>
              <View style={styles.originRow}>
                <View style={styles.originProtocolShadow}>
                  <TouchableOpacity
                    testID="editor-origin-protocol"
                    accessibilityRole="button"
                    accessibilityLabel={t("选择网站协议")}
                    accessibilityState={{ expanded: originProtocolMenuOpen }}
                    activeOpacity={0.76}
                    style={styles.originProtocolButton}
                    onPress={() => setOriginProtocolMenuOpen((open) => !open)}
                  >
                    <Text style={styles.originProtocolText}>{form.originProtocol}://</Text>
                    <SymbolView
                      name={originProtocolMenuOpen
                        ? { ios: "chevron.up", android: "keyboard_arrow_up", web: "keyboard_arrow_up" }
                        : { ios: "chevron.down", android: "keyboard_arrow_down", web: "keyboard_arrow_down" }}
                      size={19}
                      tintColor={colors.primary}
                    />
                  </TouchableOpacity>
                </View>
                <TextInput
                  testID="editor-origin"
                  value={form.origin}
                  onChangeText={updateOrigin}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="example.com"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.input, styles.originInput]}
                />
              </View>
              {originProtocolMenuOpen ? (
                <View testID="editor-origin-protocol-menu" style={styles.originProtocolMenu}>
                  {(["https", "http"] as const).map((protocol) => (
                    <TouchableOpacity
                      key={protocol}
                      testID={`editor-origin-protocol-${protocol}`}
                      accessibilityRole="menuitem"
                      accessibilityState={{ selected: form.originProtocol === protocol }}
                      style={[
                        styles.originProtocolOption,
                        form.originProtocol === protocol && styles.originProtocolOptionActive,
                      ]}
                      onPress={() => {
                        field("originProtocol", protocol);
                        setOriginProtocolMenuOpen(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.originProtocolOptionText,
                          form.originProtocol === protocol && styles.originProtocolOptionTextActive,
                        ]}
                      >
                        {protocol}://
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
            <Input testID="editor-username" label={t("用户名")} value={form.username} onChangeText={(value) => field("username", value)} autoCapitalize="none" />
            <Input testID="editor-password" label={t("密码")} value={form.password} onChangeText={(value) => field("password", value)} secureTextEntry />
            <View style={styles.generatorPanel}>
              <Text style={styles.label}>{t("密码生成器")}</Text>
              <View style={styles.choiceRow}>
                {[16, 20, 24, 32].map((length) => (
                  <ChoiceButton
                    key={length}
                    label={t(`${length} 位`)}
                    active={generatorOptions.length === length}
                    onPress={() => setGeneratorOptions((current) => ({ ...current, length }))}
                  />
                ))}
              </View>
              <View style={styles.choiceRow}>
                <ChoiceButton label={t("大写")} active={generatorOptions.upper} onPress={() => toggleGeneratorClass("upper")} />
                <ChoiceButton label={t("小写")} active={generatorOptions.lower} onPress={() => toggleGeneratorClass("lower")} />
                <ChoiceButton label={t("数字")} active={generatorOptions.digits} onPress={() => toggleGeneratorClass("digits")} />
                <ChoiceButton label={t("符号")} active={generatorOptions.symbols} onPress={() => toggleGeneratorClass("symbols")} />
              </View>
              <TouchableOpacity testID="editor-generate-password" style={styles.secondaryButton} onPress={() => { void createPassword(); }}>
                <Text style={styles.secondaryText}>{t("生成并填入密码")}</Text>
              </TouchableOpacity>
            </View>
            <Input testID="editor-totp" label={t("TOTP 密钥或 otpauth URI")} value={form.totp} onChangeText={(value) => field("totp", value)} autoCapitalize="none" />
            <Text style={styles.sectionTitle}>{t("Android App 关联（高级）")}</Text>
            <Text style={styles.help}>
              {t("只有包名和发布签名证书 SHA-256 都精确匹配时才允许填充。不要填写调试证书。")}
            </Text>
            <TouchableOpacity
              testID="editor-installed-app-picker-open"
              accessibilityRole="button"
              style={[styles.secondaryButton, installedAppsLoading && styles.disabled]}
              disabled={installedAppsLoading}
              onPress={() => { void openInstalledAppPicker(); }}
            >
              {installedAppsLoading
                ? <ActivityIndicator color={colors.primary} />
                : <Text style={styles.secondaryText}>{t("从已安装 App 选择")}</Text>}
            </TouchableOpacity>
            {form.androidAssociations.map((association, index) => (
              <View key={`android-association-${index}`} style={styles.customField}>
                <Input
                  testID={`editor-android-package-name-${index}`}
                  label={t("Android 包名")}
                  value={association.packageName}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(value) => setForm((current) => ({
                    ...current,
                    androidAssociations: current.androidAssociations.map((entry, itemIndex) =>
                      itemIndex === index ? { ...entry, packageName: value } : entry),
                  }))}
                />
                <Input
                  testID={`editor-android-signing-certificate-sha256-${index}`}
                  label={t("发布签名证书 SHA-256")}
                  value={association.signingCertificateSha256}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={(value) => setForm((current) => ({
                    ...current,
                    androidAssociations: current.androidAssociations.map((entry, itemIndex) =>
                      itemIndex === index ? { ...entry, signingCertificateSha256: value } : entry),
                  }))}
                />
                <TouchableOpacity
                  testID={`editor-android-association-remove-${index}`}
                  accessibilityRole="button"
                  onPress={() => setForm((current) => ({
                    ...current,
                    androidAssociations: current.androidAssociations.filter((_, itemIndex) => itemIndex !== index),
                  }))}
                >
                  <Text style={styles.danger}>{t("删除 App 关联")}</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity
              testID="editor-android-association-add"
              accessibilityRole="button"
              style={styles.secondaryButton}
              onPress={() => setForm((current) => ({
                ...current,
                androidAssociations: [
                  ...current.androidAssociations,
                  { packageName: "", signingCertificateSha256: "" },
                ],
              }))}
            >
              <Text style={styles.secondaryText}>{t("添加 Android App 关联")}</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {form.type === "secure_note" ? <Input testID="editor-note-body" label={t("笔记内容")} value={form.noteBody} onChangeText={(value) => field("noteBody", value)} multiline /> : null}

        {form.type === "credit_card" ? (
          <>
            <Input testID="editor-cardholder" label={t("持卡人")} value={form.cardholderName} onChangeText={(value) => field("cardholderName", value)} />
            <Input testID="editor-card-number" label={t("卡号")} value={form.cardNumber} onChangeText={(value) => field("cardNumber", value.replace(/\D/gu, ""))} keyboardType="number-pad" maxLength={32} />
            <View style={styles.inline}>
              <View style={styles.flex}><Input testID="editor-card-month" label={t("月份")} value={form.expirationMonth} onChangeText={(value) => field("expirationMonth", value.replace(/\D/gu, ""))} keyboardType="number-pad" maxLength={2} /></View>
              <View style={styles.flex}><Input testID="editor-card-year" label={t("年份")} value={form.expirationYear} onChangeText={(value) => field("expirationYear", value.replace(/\D/gu, ""))} keyboardType="number-pad" maxLength={4} /></View>
              <View style={styles.flex}><Input testID="editor-card-cvv" label="CVV" value={form.cvv} onChangeText={(value) => field("cvv", value.replace(/\D/gu, ""))} keyboardType="number-pad" maxLength={8} secureTextEntry /></View>
            </View>
            <Input label={t("卡组织")} value={form.brand} onChangeText={(value) => field("brand", value)} />
          </>
        ) : null}

        <Input label={t("备注")} value={form.notes} onChangeText={(value) => field("notes", value)} multiline />

        <Text style={styles.sectionTitle}>{t("自定义字段")}</Text>
        {form.customFields.map((entry, index) => (
          <View key={index} style={styles.customField}>
            <Input label={t("名称")} value={entry.name} onChangeText={(value) => setForm((current) => ({ ...current, customFields: current.customFields.map((item, i) => i === index ? { ...item, name: value } : item) }))} />
            <TouchableOpacity
              accessibilityRole="button"
              style={styles.fieldTypeButton}
              onPress={() => setForm((current) => ({
                ...current,
                customFields: current.customFields.map((item, itemIndex) => {
                  if (itemIndex !== index) return item;
                  const fieldType = item.fieldType === "text" ? "hidden" : item.fieldType === "hidden" ? "boolean" : "text";
                  return { ...item, fieldType, value: fieldType === "boolean" ? (item.value === "true" ? "true" : "false") : item.value };
                }),
              }))}
            >
              <Text style={styles.secondaryText}>
                {entry.fieldType === "text"
                  ? t("类型：文本　›")
                  : entry.fieldType === "hidden"
                    ? t("类型：隐藏　›")
                    : t("类型：布尔值　›")}
              </Text>
            </TouchableOpacity>
            {entry.fieldType === "boolean" ? (
              <TouchableOpacity
                accessibilityRole="switch"
                accessibilityState={{ checked: entry.value === "true" }}
                style={styles.booleanButton}
                onPress={() => setForm((current) => ({
                  ...current,
                  customFields: current.customFields.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, value: item.value === "true" ? "false" : "true" } : item),
                }))}
              >
                <Text style={styles.secondaryText}>{entry.value === "true" ? t("是") : t("否")}</Text>
              </TouchableOpacity>
            ) : (
              <Input label={t("值")} value={entry.value} secureTextEntry={entry.fieldType === "hidden"} onChangeText={(value) => setForm((current) => ({ ...current, customFields: current.customFields.map((item, i) => i === index ? { ...item, value } : item) }))} />
            )}
            <TouchableOpacity onPress={() => setForm((current) => ({ ...current, customFields: current.customFields.filter((_, i) => i !== index) }))}><Text style={styles.danger}>{t("删除字段")}</Text></TouchableOpacity>
          </View>
        ))}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => setForm((current) => ({ ...current, customFields: [...current.customFields, { name: "", value: "", fieldType: "text" }] }))}>
          <Text style={styles.secondaryText}>{t("添加自定义字段")}</Text>
        </TouchableOpacity>

        <TouchableOpacity testID="editor-save" accessibilityRole="button" style={[styles.saveButton, (saving || isLoading) && styles.disabled]} disabled={saving || isLoading || !form.title.trim()} onPress={save}>
          {saving ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={styles.saveText}>{t("保存并加入同步队列")}</Text>}
        </TouchableOpacity>
      </ScrollView>
      <Modal
        testID="editor-installed-app-picker"
        animationType="fade"
        transparent
        statusBarTranslucent
        visible={installedAppPickerVisible}
        onRequestClose={() => setInstalledAppPickerVisible(false)}
      >
        <View style={styles.pickerBackdrop}>
          <SafeAreaView style={styles.pickerSheet}>
            <View style={styles.pickerHeader}>
              <View style={styles.pickerHeading}>
                <Text style={styles.pickerTitle}>{t("选择已安装 App")}</Text>
                <Text style={styles.help}>
                  {t("仅显示具有启动入口且能读取单一当前发布签名的 App。")}
                </Text>
              </View>
              <TouchableOpacity
                testID="editor-installed-app-picker-close"
                accessibilityRole="button"
                style={styles.pickerCloseButton}
                onPress={() => setInstalledAppPickerVisible(false)}
              >
                <Text style={styles.secondaryText}>{t("取消")}</Text>
              </TouchableOpacity>
            </View>
            {installedAppsLoading ? (
              <View style={styles.pickerEmpty}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.muted}>{t("正在读取已安装 App…")}</Text>
              </View>
            ) : installedApps.length === 0 ? (
              <View style={styles.pickerEmpty}>
                <Text style={styles.muted}>{t("未找到可安全关联的 App")}</Text>
              </View>
            ) : (
              <ScrollView
                style={styles.pickerList}
                contentContainerStyle={styles.pickerListContent}
                keyboardShouldPersistTaps="handled"
              >
                {installedApps.map((app) => {
                  const selected = form.androidAssociations.some((association) =>
                    association.packageName.trim() === app.packageName &&
                    association.signingCertificateSha256
                      .replace(/[^A-Fa-f0-9]/gu, "")
                      .toUpperCase() === app.signingCertificateSha256);
                  return (
                    <TouchableOpacity
                      key={app.packageName}
                      testID={`editor-installed-app-${app.packageName}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      style={[styles.installedAppRow, selected && styles.installedAppRowSelected]}
                      onPress={() => selectInstalledApp(app)}
                    >
                      <View style={styles.installedAppHeading}>
                        <Text style={styles.installedAppLabel}>{app.label}</Text>
                        {selected ? <Text style={styles.associatedBadge}>{t("已关联")}</Text> : null}
                      </View>
                      <Text style={styles.installedAppPackage}>{app.packageName}</Text>
                      <Text style={styles.installedAppCertificate}>
                        {app.signingCertificateSha256}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Input(props: ComponentProps<typeof TextInput> & { label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [focused, setFocused] = useState(false);
  const { label, multiline, onFocus, onBlur, ...inputProps } = props;
  return (
    <View style={styles.inputGroup}>
      <View style={styles.labelRow}>
        <View style={[styles.labelPixel, focused && styles.labelPixelActive]} />
        <Text style={[styles.label, focused && styles.labelActive]}>{label}</Text>
      </View>
      <TextInput
        {...inputProps}
        multiline={multiline}
        placeholderTextColor={colors.textMuted}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[styles.input, multiline && styles.multiline, focused && styles.inputFocused]}
      />
    </View>
  );
}

function ChoiceButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={[styles.choiceButton, active && styles.choiceButtonActive]}
      onPress={onPress}
    >
      <Text style={active ? styles.choiceTextActive : styles.choiceText}>{label}</Text>
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: {
    padding: spacing.base,
    paddingTop: spacing.md,
    gap: spacing.md,
    paddingBottom: 56,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted },
  typeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingBottom: spacing.sm,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
  },
  typeButton: {
    flex: 1,
    minHeight: 52,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
  },
  typeButtonActive: {
    backgroundColor: colors.primary,
    borderColor: colors.textPrimary,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  typeText: { color: colors.textSecondary },
  typeTextActive: { color: colors.primaryContrast, fontWeight: fontWeight.semibold },
  inputGroup: { gap: spacing.xs },
  labelRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  labelPixel: { width: 6, height: 6, backgroundColor: colors.borderStrong },
  labelPixelActive: { backgroundColor: colors.primary },
  label: { color: colors.textSecondary, fontSize: fontSize.bodySm },
  labelActive: { color: colors.primary, fontWeight: fontWeight.semibold },
  input: {
    minHeight: 50,
    color: colors.textPrimary,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputFocused: {
    borderColor: colors.primary,
    backgroundColor: colors.bgShell,
  },
  multiline: { minHeight: 112, textAlignVertical: "top" },
  folderField: { gap: spacing.xs },
  folderSuggestions: {
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSoft,
    padding: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  folderSuggestionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  folderSuggestionTitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
  },
  folderSuggestionAction: { color: colors.textMuted, fontSize: fontSize.caption },
  folderSuggestionList: { gap: spacing.xs, paddingRight: spacing.xs },
  folderSuggestion: {
    minHeight: minTouchTarget,
    maxWidth: 180,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.sm,
  },
  folderSuggestionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.textPrimary,
  },
  folderSuggestionText: {
    flexShrink: 1,
    color: colors.primary,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },
  folderSuggestionTextSelected: {
    color: colors.primaryContrast,
    fontWeight: fontWeight.semibold,
  },
  folderHint: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    lineHeight: 18,
  },
  originRow: { flexDirection: "row", alignItems: "stretch", gap: spacing.xs },
  originProtocolShadow: {
    minWidth: 112,
    paddingRight: 3,
    paddingBottom: 3,
    backgroundColor: colors.shadow,
  },
  originProtocolButton: {
    minHeight: 50,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
  },
  originProtocolText: { color: colors.primary, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  originInput: { flex: 1 },
  originProtocolMenu: {
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.xs,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
  },
  originProtocolOption: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.sm,
  },
  originProtocolOptionActive: { backgroundColor: colors.primary, borderColor: colors.textPrimary },
  originProtocolOptionText: { color: colors.textSecondary, fontSize: fontSize.bodySm },
  originProtocolOptionTextActive: { color: colors.primaryContrast, fontWeight: fontWeight.semibold },
  inline: { flexDirection: "row", gap: spacing.sm },
  flex: { flex: 1 },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    marginTop: spacing.md,
    borderLeftWidth: 6,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.sm,
  },
  help: { color: colors.textMuted, fontSize: fontSize.caption, lineHeight: 18 },
  customField: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    backgroundColor: colors.bgPanelSoft,
  },
  generatorPanel: {
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    backgroundColor: colors.bgPanelSoft,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  choiceRow: { flexDirection: "row", gap: spacing.xs },
  choiceButton: {
    flex: 1,
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
  },
  choiceButtonActive: { backgroundColor: colors.primary, borderColor: colors.textPrimary },
  choiceText: { color: colors.textSecondary, fontSize: fontSize.caption },
  choiceTextActive: { color: colors.primaryContrast, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  fieldTypeButton: { minHeight: minTouchTarget, justifyContent: "center" },
  booleanButton: {
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
  },
  secondaryButton: {
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
  },
  secondaryText: { color: colors.primary, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  danger: { color: colors.danger, minHeight: minTouchTarget, textAlignVertical: "center", fontWeight: fontWeight.medium },
  saveButton: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    borderRadius: radius.sm,
    marginTop: spacing.md,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  saveText: { color: colors.primaryContrast, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  disabled: { opacity: 0.5 },
  pickerBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  pickerSheet: {
    maxHeight: "86%",
    backgroundColor: colors.bgPanel,
    borderTopWidth: 3,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderColor: colors.textPrimary,
    padding: spacing.base,
    gap: spacing.md,
  },
  pickerHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  pickerHeading: { flex: 1, gap: spacing.xs },
  pickerTitle: { color: colors.textPrimary, fontSize: fontSize.heading, fontWeight: fontWeight.semibold },
  pickerCloseButton: { minWidth: minTouchTarget, minHeight: minTouchTarget, alignItems: "center", justifyContent: "center" },
  pickerEmpty: { minHeight: 180, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  pickerList: { flexShrink: 1 },
  pickerListContent: { gap: spacing.sm, paddingBottom: spacing.md },
  installedAppRow: { gap: spacing.xs, borderWidth: 2, borderColor: colors.border, borderRadius: radius.sm, padding: spacing.md },
  installedAppRowSelected: { borderColor: colors.primary, backgroundColor: colors.bgPanelSoft },
  installedAppHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  installedAppLabel: { flex: 1, color: colors.textPrimary, fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  associatedBadge: { color: colors.primary, fontSize: fontSize.caption },
  installedAppPackage: { color: colors.textSecondary, fontSize: fontSize.bodySm },
  installedAppCertificate: { color: colors.textMuted, fontSize: fontSize.caption, lineHeight: 18 },
});
