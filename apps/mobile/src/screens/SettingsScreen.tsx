import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AppState,
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import Constants from "expo-constants";
import { spacing, radius, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme, type ThemePreference } from "../theme/theme";
import { useI18n, type AppLanguage } from "../i18n";
import { saveLanguagePreference } from "../i18n/persistence";
import { useVaultState, useAuthState } from "../state/app-state";
import {
  getNativeAutofillConfiguration,
  openNativeAutofillSettings,
  openNativeCredentialProviderSettings,
  type NativeAutofillConfiguration,
} from "@zero-vault/zero-vault-native";
import { Text } from "../components/Typography";

const UNAVAILABLE_AUTOFILL: NativeAutofillConfiguration = {
  availability: "UNAVAILABLE",
  autofillSupported: false,
  autofillEnabled: false,
  credentialProviderSupported: false,
  credentialProviderEnabled: false,
};

const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];
const LANGUAGE_OPTIONS: ReadonlyArray<{ value: AppLanguage; label: string }> = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

export function SettingsScreen() {
  const router = useRouter();
  const { language, t } = useI18n();
  const { colors, preference: themePreference, setPreference: setThemePreference } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    lock,
    isLocked,
    enableBiometric,
    autoLockMinutes,
    setAutoLockMinutes,
    conflictCount,
  } = useVaultState();
  const { logout, user } = useAuthState();
  const [autofill, setAutofill] = useState<NativeAutofillConfiguration>(UNAVAILABLE_AUTOFILL);

  const refreshAutofill = useCallback((): NativeAutofillConfiguration => {
    try {
      const next = getNativeAutofillConfiguration();
      setAutofill(next);
      return next;
    } catch {
      setAutofill(UNAVAILABLE_AUTOFILL);
      return UNAVAILABLE_AUTOFILL;
    }
  }, []);

  useEffect(() => {
    refreshAutofill();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refreshAutofill();
    });
    return () => subscription.remove();
  }, [refreshAutofill]);

  const handleLock = useCallback(() => {
    lock();
    router.replace("/unlock");
  }, [lock, router]);

  const handleLogout = useCallback(() => {
    Alert.alert(t("确认退出"), t("退出后需要重新登录"), [
      { text: t("取消"), style: "cancel" },
      {
        text: t("退出"),
        style: "destructive",
        onPress: async () => {
          if (await logout()) router.replace("/login");
        },
      },
    ]);
  }, [logout, router, t]);

  const handleAutoLockChange = useCallback(() => {
    const options = [1, 5, 15, 30, 60];
    Alert.alert(
      t("自动锁定时间"),
      t("选择自动锁定时间（分钟）"),
      options.map((m) => ({
        text: t(`${m} 分钟`),
        onPress: () => {
          void setAutoLockMinutes(m).then((saved) => {
            if (!saved) {
              Alert.alert(
                t("未能保存"),
                t("自动锁定设置未能安全保存，已使用 5 分钟默认值。"),
              );
            }
          });
        },
      }))
    );
  }, [setAutoLockMinutes, t]);

  const handleEnableBiometric = useCallback(async () => {
    if (isLocked) {
      Alert.alert(t("请先解锁"), t("启用生物识别前需要先解锁密码库。"));
      return;
    }
    const enabled = await enableBiometric();
    refreshAutofill();
    Alert.alert(
      enabled ? t("已启用") : t("未能启用"),
      enabled
        ? t("以后可使用系统生物识别解锁。生物信息变化会使本机密钥失效，不会降级为普通密钥。")
        : t("系统认证未完成，当前密钥策略未改变。"),
    );
  }, [enableBiometric, isLocked, refreshAutofill, t]);

  const handleOpenAutofillSettings = useCallback(async () => {
    const current = refreshAutofill();
    if (!current.autofillSupported) {
      Alert.alert(t("系统不支持"), t("当前设备未提供 Android 自动填充服务。"));
      return;
    }
    if (current.availability === "UNAVAILABLE") {
      Alert.alert(
        t("先启用强生物识别"),
        t("请先解锁密码库并启用严格强生物识别。系统服务不会降级使用设备密码。"),
      );
      return;
    }
    if (current.autofillEnabled) {
      Alert.alert(t("已启用"), t("Zero Vault 已是当前自动填充服务。"));
      return;
    }
    try {
      await openNativeAutofillSettings();
    } catch {
      Alert.alert(t("无法打开设置"), t("系统自动填充设置当前不可用。"));
    }
  }, [refreshAutofill, t]);

  const handleOpenCredentialProviderSettings = useCallback(async () => {
    const current = refreshAutofill();
    if (!current.credentialProviderSupported) {
      Alert.alert(t("系统不支持"), t("系统凭据提供方需要 Android 14 或更高版本。"));
      return;
    }
    if (current.availability === "UNAVAILABLE") {
      Alert.alert(
        t("先启用强生物识别"),
        t("请先解锁密码库并启用严格强生物识别，再启用凭据提供方。"),
      );
      return;
    }
    if (current.credentialProviderEnabled) {
      Alert.alert(t("已启用"), t("Zero Vault 凭据提供方已启用。"));
      return;
    }
    try {
      await openNativeCredentialProviderSettings();
    } catch {
      Alert.alert(t("无法打开设置"), t("系统凭据提供方设置当前不可用。"));
    }
  }, [refreshAutofill, t]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titlePanel}>
          <View style={styles.titleIcon}>
            <SymbolView
              name={{ ios: "switch.2", android: "tune", web: "tune" }}
              size={27}
              tintColor={colors.primary}
            />
          </View>
          <View style={styles.titleCopy}>
            <Text style={styles.title}>{t("设置")}</Text>
            <View style={styles.titleSignal}>
              <View style={styles.titleSignalActive} />
              <View style={styles.titleSignalActive} />
              <View style={styles.titleSignalIdle} />
              <View style={styles.titleSignalIdle} />
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("账户")}</Text>
          {user ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={t("管理账户")}
              style={styles.card}
              onPress={() => router.push("/account")}
            >
              <Text style={styles.cardLabel}>{t("邮箱")}</Text>
              <Text style={styles.cardValue}>{user.email}</Text>
              <Text style={styles.navValue}>{t("账户、安全操作与永久删除　›")}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("外观")}</Text>
          <View style={styles.themeRow}>
            {THEME_OPTIONS.map((option) => {
              const selected = option.value === themePreference;
              return (
                <TouchableOpacity
                  key={option.value}
                  testID={`settings-theme-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityLabel={t(`${option.label}主题`)}
                  accessibilityState={{ checked: selected }}
                  style={[styles.themeButton, selected && styles.themeButtonSelected]}
                  onPress={() => {
                    void setThemePreference(option.value).then((saved) => {
                      if (!saved) {
                        Alert.alert(t("未能保存"), t("主题设置保存失败，请重试。"));
                      }
                    });
                  }}
                >
                  <Text style={selected ? styles.themeTextSelected : styles.themeText}>
                    {t(option.label)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <Text style={styles.optionLabel}>{t("语言")}</Text>
          <View style={styles.themeRow}>
            {LANGUAGE_OPTIONS.map((option) => {
              const selected = option.value === language;
              return (
                <TouchableOpacity
                  key={option.value}
                  testID={`settings-language-${option.value}`}
                  accessibilityRole="radio"
                  accessibilityLabel={option.label}
                  accessibilityState={{ checked: selected }}
                  style={[styles.themeButton, selected && styles.themeButtonSelected]}
                  onPress={() => {
                    void saveLanguagePreference(option.value).then((saved) => {
                      if (!saved) Alert.alert(t("未能保存"), t("语言设置保存失败，请重试。"));
                    });
                  }}
                >
                  <Text style={selected ? styles.themeTextSelected : styles.themeText}>
                    {t(option.label)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("安全")}</Text>
          <TouchableOpacity style={styles.card} onPress={handleAutoLockChange}>
            <Text style={styles.cardLabel}>{t("自动锁定")}</Text>
            <Text style={styles.cardValue}>{t(`${autoLockMinutes} 分钟`)}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-biometric"
            style={styles.card}
            onPress={() => { void handleEnableBiometric(); }}
          >
            <Text style={styles.cardLabel}>{t("强生物识别")}</Text>
            <Text style={styles.navValue}>{t("在 Android 密钥库中启用强生物识别密钥 ›")}</Text>
          </TouchableOpacity>

          <TouchableOpacity testID="settings-lock-now" style={styles.card} onPress={handleLock}>
            <Text style={styles.dangerText}>{t("立即锁定")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("管理可信设备")}
            style={styles.card}
            onPress={() => router.push("/devices")}
          >
            <Text style={styles.cardLabel}>{t("设备信任")}</Text>
            <Text style={styles.navValue}>{t("管理可信设备与待批准设备　›")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-recovery"
            accessibilityRole="button"
            accessibilityLabel={t("恢复或轮换恢复码")}
            style={styles.card}
            onPress={() => router.push("/recovery")}
          >
            <Text style={styles.cardLabel}>{t("密码库恢复")}</Text>
            <Text style={styles.navValue}>{t("使用或轮换离线恢复码　›")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("处理同步冲突，当前 {count} 条", { count: conflictCount })}
            style={[styles.card, conflictCount > 0 && styles.warningCard]}
            onPress={() => router.push("/conflicts")}
          >
            <Text style={styles.cardLabel}>{t("同步冲突")}</Text>
            <Text style={conflictCount > 0 ? styles.warningValue : styles.navValue}>
              {conflictCount > 0
                ? t(`${conflictCount} 条等待处理　›`)
                : t("当前没有冲突　›")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-password-health"
            accessibilityRole="button"
            accessibilityLabel={t("查看密码健康")}
            style={styles.card}
            onPress={() => router.push("/password-health")}
          >
            <Text style={styles.cardLabel}>{t("密码健康")}</Text>
            <Text style={styles.navValue}>{t("本机检查缺失、弱密码和重复使用　›")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-local-backup"
            accessibilityRole="button"
            accessibilityLabel={t("管理本地加密备份与导入")}
            style={styles.card}
            onPress={() => router.push("/local-backup")}
          >
            <Text style={styles.cardLabel}>{t("本地加密备份与导入")}</Text>
            <Text style={styles.navValue}>{t("导出密文备份或导入跨平台加密备份 ›")}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-cloud-backup"
            accessibilityRole="button"
            accessibilityLabel={t("管理加密云备份")}
            style={styles.card}
            onPress={() => router.push("/cloud-backup")}
          >
            <Text style={styles.cardLabel}>{t("加密云备份")}</Text>
            <Text style={styles.navValue}>{t("创建、恢复或删除服务器密文快照　›")}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("自动填充与凭据")}</Text>
          <View
            testID="settings-autofill-status"
            style={[styles.card, autofill.availability === "UNAVAILABLE" && styles.warningCard]}
          >
            <Text style={styles.cardLabel}>{t("安全可用性")}</Text>
            <Text style={autofill.availability === "UNAVAILABLE" ? styles.warningValue : styles.cardValue}>
              {autofill.availability === "READY"
                ? t("已解锁，可安全填充")
                : autofill.availability === "LOCKED_BIOMETRIC"
                  ? t("已锁定，填充时验证生物识别")
                  : t("尚未完成安全配置")}
            </Text>
            <Text style={styles.hint}>
              {t("仅使用 Android 密钥库与强生物识别；不可用时不会返回候选项或明文凭据。")}
            </Text>
          </View>

          <TouchableOpacity
            testID="settings-autofill"
            accessibilityRole="button"
            accessibilityLabel={t("启用 Android 自动填充服务")}
            style={styles.card}
            onPress={() => { void handleOpenAutofillSettings(); }}
          >
            <Text style={styles.cardLabel}>{t("Android 自动填充")}</Text>
            <Text style={autofill.autofillEnabled ? styles.cardValue : styles.navValue}>
              {autofill.autofillEnabled
                ? t("已启用")
                : autofill.autofillSupported
                  ? t("打开系统选择页　›")
                  : t("系统不支持")}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            testID="settings-credential-provider"
            accessibilityRole="button"
            accessibilityLabel={t("启用 Android 系统凭据提供方")}
            style={styles.card}
            onPress={() => { void handleOpenCredentialProviderSettings(); }}
          >
            <Text style={styles.cardLabel}>{t("系统凭据提供方")}</Text>
            <Text style={autofill.credentialProviderEnabled ? styles.cardValue : styles.navValue}>
              {autofill.credentialProviderEnabled
                ? t("已启用")
                : autofill.credentialProviderSupported
                  ? t("打开系统设置　›")
                  : t("需要 Android 14 或更高版本")}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t("关于")}</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>{t("版本")}</Text>
            <Text style={styles.cardValue}>
              {Constants.expoConfig?.version ?? "0.1.0"}
            </Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>{t("退出登录")}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  content: {
    padding: spacing.base,
    paddingBottom: 56,
  },
  titlePanel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgPanelSoft,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  titleIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bgPanel,
  },
  titleCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  titleSignal: {
    flexDirection: "row",
    gap: 3,
  },
  titleSignalActive: {
    width: 16,
    height: 3,
    backgroundColor: colors.primary,
  },
  titleSignalIdle: {
    width: 16,
    height: 3,
    backgroundColor: colors.borderStrong,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    textTransform: "uppercase",
    marginBottom: spacing.md,
    borderLeftWidth: 6,
    borderLeftColor: colors.primary,
    borderBottomWidth: 2,
    borderBottomColor: colors.border,
    paddingLeft: spacing.sm,
    paddingBottom: spacing.xs,
    letterSpacing: 1,
  },
  themeRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  optionLabel: {
    marginTop: spacing.md,
    marginBottom: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
  },
  themeButton: {
    flex: 1,
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.xs,
  },
  themeButtonSelected: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.primary,
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  themeText: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
  },
  themeTextSelected: {
    color: colors.primaryContrast,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderLeftWidth: 5,
    borderColor: colors.borderStrong,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
    minHeight: 64,
    justifyContent: "center",
    shadowColor: colors.border,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 1,
  },
  cardLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
  },
  navValue: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  hint: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  warningCard: {
    borderColor: colors.warning,
    borderLeftColor: colors.warning,
  },
  warningValue: {
    fontSize: fontSize.body,
    color: colors.warning,
    fontWeight: fontWeight.semibold,
  },
  dangerText: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: fontWeight.medium,
    textAlign: "center",
  },
  logoutButton: {
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: minTouchTarget,
    justifyContent: "center",
    marginTop: spacing.md,
    backgroundColor: colors.bgPanel,
    shadowColor: colors.danger,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  logoutText: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  });
}
