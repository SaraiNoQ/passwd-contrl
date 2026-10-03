import { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  AppState,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { spacing, radius, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { useAuthState, useVaultState } from "../state/app-state";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";

export function UnlockScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuthState();
  const vault = useVaultState();
  const [masterPassword, setMasterPassword] = useState("");
  const isLoading = auth.isLoading || vault.isLoading;
  const error = auth.error ?? vault.error;
  const unlockState = vault.localDeviceSecurityState?.unlockState ?? null;
  const securityFailure = vault.localDeviceSecurityFailure;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setMasterPassword("");
      } else {
        void vault.refreshLocalDeviceSecurityState();
      }
    });
    return () => subscription.remove();
  }, [vault.refreshLocalDeviceSecurityState]);

  useEffect(() => {
    void vault.refreshLocalDeviceSecurityState();
  }, [vault.refreshLocalDeviceSecurityState]);

  const handleUnlock = useCallback(async () => {
    auth.clearError();
    vault.clearError();
    try {
      if (!(await auth.authorizeVaultUnlock(masterPassword))) return;
      if (await vault.unlock()) router.replace("/(tabs)/vault");
    } finally {
      setMasterPassword("");
    }
  }, [auth, masterPassword, router, vault]);

  const handleBiometricUnlock = useCallback(async () => {
    auth.clearError();
    vault.clearError();
    if (await vault.unlockWithBiometric()) router.replace("/(tabs)/vault");
  }, [auth, router, vault]);

  const handleRecovery = useCallback(() => {
    vault.lock();
    router.push("/recovery");
  }, [router, vault]);

  const handleTrustedDeviceRebind = useCallback(() => {
    Alert.alert(
      t("重新绑定此设备？"),
      t("当前设备身份和本机会话将被销毁。重新登录后，需要在另一台可信设备上核对新指纹并批准。"),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("销毁并重新绑定"),
          style: "destructive",
          onPress: () => {
            void (async () => {
              if (await auth.beginTrustedDeviceRebind()) {
                vault.lock();
                router.replace("/login");
              }
            })();
          },
        },
      ],
    );
  }, [auth, router, t, vault]);

  const unavailable = unlockState === "BIOMETRIC_UNAVAILABLE";
  const invalidated = unlockState === "BIOMETRIC_INVALIDATED";
  const deviceKeyInvalidated = unlockState === "DEVICE_KEY_INVALIDATED";
  const recoveryRequired =
    invalidated || deviceKeyInvalidated || securityFailure === "RECOVERY_REQUIRED";
  const nativeUnavailable = securityFailure === "NATIVE_UNAVAILABLE";
  const securityLoading = unlockState === null && securityFailure === null;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.pixelMark} accessible={false}>
              <View style={[styles.pixel, styles.pixelTop]} />
              <View style={[styles.pixel, styles.pixelMiddle]} />
              <View style={[styles.pixel, styles.pixelBottom]} />
            </View>
            <Text style={styles.title}>{t("解锁密码库")}</Text>
            <Text style={styles.subtitle}>
              {unlockState === "PASSWORD_ALLOWED"
                ? t("输入主密码以解锁本地密码库")
                : unlockState === "BIOMETRIC_READY"
                  ? t("此设备要求使用强生物识别")
                  : unavailable
                    ? t("强生物识别当前不可用")
                    : recoveryRequired
                      ? t("本机安全密钥已失效，需要安全恢复")
                      : nativeUnavailable
                        ? t("本机安全模块不可用")
                        : t("正在验证本机安全状态")}
            </Text>
          </View>

          <View style={styles.card}>
            <View style={styles.pixelRail} accessible={false}>
              <View style={[styles.railPixel, styles.railPrimary]} />
              <View style={[styles.railPixel, styles.railAccent]} />
              <View style={[styles.railPixel, styles.railWarning]} />
              <View style={styles.railLine} />
            </View>
            <View style={styles.form}>
              {securityLoading ? (
                <View testID="unlock-security-loading" style={styles.securityState}>
                  <ActivityIndicator color={colors.primary} />
                  <Text style={styles.stateText}>{t("正在读取 Keystore 与设备策略…")}</Text>
                </View>
              ) : null}

              {unlockState === "PASSWORD_ALLOWED" ? (
                <>
                  <Text style={styles.label}>{t("主密码")}</Text>
                  <TextInput
                    testID="unlock-password"
                    accessibilityLabel={t("主密码")}
                    style={styles.input}
                    value={masterPassword}
                    onChangeText={setMasterPassword}
                    placeholder={t("输入主密码")}
                    placeholderTextColor={colors.textMuted}
                    secureTextEntry
                    autoComplete="password"
                  />
                  <TouchableOpacity
                    testID="unlock-submit"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isLoading || !masterPassword }}
                    style={[styles.button, (isLoading || !masterPassword) && styles.buttonDisabled]}
                    onPress={handleUnlock}
                    disabled={isLoading || !masterPassword}
                    activeOpacity={0.82}
                  >
                    {isLoading ? (
                      <ActivityIndicator color={colors.primaryContrast} />
                    ) : (
                      <Text style={styles.buttonText}>{t("解锁")}</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : null}

              {unlockState === "BIOMETRIC_READY" ? (
                <TouchableOpacity
                  testID="unlock-biometric"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isLoading }}
                  style={[styles.button, isLoading && styles.buttonDisabled]}
                  onPress={handleBiometricUnlock}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator color={colors.primaryContrast} />
                  ) : (
                    <Text style={styles.buttonText}>{t("使用强生物识别解锁")}</Text>
                  )}
                </TouchableOpacity>
              ) : null}

              {unavailable || recoveryRequired ? (
                <View testID={`unlock-security-${unavailable ? "unavailable" : "invalidated"}`} style={styles.securityState}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {unavailable
                      ? t("强生物识别当前不可用。为防止绕过设备策略，主密码解锁已禁用。")
                      : deviceKeyInvalidated
                        ? t("本机设备密钥已失效。主密码不能替代设备身份，请执行安全恢复或重新绑定。")
                        : invalidated
                          ? t("生物识别密钥已失效。为防止降级攻击，主密码解锁仍保持禁用。")
                          : t("本机设备身份缺失或校验失败。请使用恢复码或销毁旧身份后重新绑定。")}
                  </Text>
                  {unavailable ? (
                    <TouchableOpacity
                      testID="unlock-security-retry"
                      accessibilityRole="button"
                      style={styles.secondaryButton}
                      onPress={() => { void vault.refreshLocalDeviceSecurityState(); }}
                      disabled={isLoading}
                    >
                      <Text style={styles.secondaryText}>{t("重新检测")}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity
                    testID="unlock-recovery"
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    onPress={handleRecovery}
                    disabled={isLoading}
                  >
                    <Text style={styles.secondaryText}>{t("使用恢复码恢复")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="unlock-rebind"
                    accessibilityRole="button"
                    style={styles.dangerButton}
                    onPress={handleTrustedDeviceRebind}
                    disabled={isLoading}
                  >
                    <Text style={styles.dangerText}>{t("通过另一台可信设备重新绑定")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {nativeUnavailable ? (
                <View testID="unlock-security-native-unavailable" style={styles.securityState}>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {t("本机安全模块当前不可用。密码、恢复和设备重绑定均已暂停，以免破坏仍受保护的本机材料。")}
                  </Text>
                  <TouchableOpacity
                    testID="unlock-security-retry"
                    accessibilityRole="button"
                    style={styles.secondaryButton}
                    onPress={() => { void vault.refreshLocalDeviceSecurityState(); }}
                    disabled={isLoading}
                  >
                    <Text style={styles.secondaryText}>{t("重新检测安全模块")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
            </View>
          </View>

          <View style={styles.securityPanel}>
            <View style={styles.securityPixel} accessible={false} />
            <Text style={styles.securityNote}>
              {unlockState === "PASSWORD_ALLOWED"
                ? t("主密码冷启动解锁需要联网；如需离线解锁，请先在联网解锁后于设置中启用强生物识别")
                : nativeUnavailable
                  ? t("请重启应用或重新安装同签名 APK；不要清除应用数据")
                  : t("已启用的设备安全策略不会自动降级为密码解锁")}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  inner: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  header: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  pixelMark: {
    width: 58,
    height: 58,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    marginBottom: spacing.md,
  },
  pixel: { position: "absolute", width: 14, height: 14 },
  pixelTop: { top: 8, left: 22, backgroundColor: colors.primary },
  pixelMiddle: { top: 22, left: 22, backgroundColor: colors.accent },
  pixelBottom: { left: 22, bottom: 8, backgroundColor: colors.success },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: 0.8,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 24,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.base,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 5,
  },
  pixelRail: {
    minHeight: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginBottom: spacing.base,
  },
  railPixel: { width: 8, height: 8 },
  railPrimary: { backgroundColor: colors.primary },
  railAccent: { backgroundColor: colors.accent },
  railWarning: { backgroundColor: colors.warning },
  railLine: { flex: 1, height: 2, backgroundColor: colors.border },
  form: {
    gap: spacing.sm,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.6,
  },
  input: {
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
    color: colors.textPrimary,
    minHeight: minTouchTarget,
  },
  error: {
    fontSize: fontSize.bodySm,
    color: colors.danger,
    lineHeight: 20,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    padding: spacing.sm,
  },
  button: {
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    marginTop: spacing.sm,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.45,
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.primaryContrast,
    textAlign: "center",
    letterSpacing: 0.8,
  },
  secondaryButton: {
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  secondaryText: {
    color: colors.primary,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
  },
  dangerButton: {
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.sm,
  },
  dangerText: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    textAlign: "center",
  },
  securityState: {
    gap: spacing.sm,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  stateText: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
    textAlign: "center",
    lineHeight: 20,
  },
  securityPanel: {
    width: "100%",
    maxWidth: 520,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  securityPixel: {
    width: 8,
    height: 8,
    backgroundColor: colors.success,
  },
  securityNote: {
    flexShrink: 1,
    fontSize: fontSize.caption,
    color: colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
});
