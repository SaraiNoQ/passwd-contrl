import { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  AppState,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { spacing, radius, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { useAuthState } from "../state/app-state";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";

export function LoginScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    login,
    user,
    device,
    registrationRecoveryCode,
    isLoading,
    error,
    clearError,
  } = useAuthState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") setPassword("");
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!user) return;
    if (registrationRecoveryCode) {
      router.replace("/recovery-code");
    } else {
      router.replace(device?.status === "approved" ? "/unlock" : "/device-approval");
    }
  }, [device?.status, registrationRecoveryCode, router, user]);

  const handleLogin = useCallback(async () => {
    clearError();
    try {
      await login(email, password);
    } finally {
      setPassword("");
    }
  }, [clearError, email, login, password]);

  const loginDisabled = isLoading || !email.trim() || !password;

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
            <Text style={styles.brand}>ZERO VAULT</Text>
            <Text style={styles.subtitle}>{t("零知识密码管理器")}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.pixelRail} accessible={false}>
              <View style={[styles.railPixel, styles.railPrimary]} />
              <View style={[styles.railPixel, styles.railAccent]} />
              <View style={[styles.railPixel, styles.railWarning]} />
              <View style={styles.railLine} />
            </View>
            <View style={styles.form}>
              <Text style={styles.label}>{t("邮箱")}</Text>
              <TextInput
                testID="login-email"
                accessibilityLabel={t("邮箱")}
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.textMuted}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />

              <Text style={styles.label}>{t("密码")}</Text>
              <TextInput
                testID="login-password"
                accessibilityLabel={t("密码")}
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                placeholder={t("输入密码")}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoComplete="current-password"
              />

              {error ? <Text testID="login-error" accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}

              <TouchableOpacity
                testID="login-submit"
                accessibilityRole="button"
                accessibilityState={{ disabled: loginDisabled }}
                style={[styles.button, loginDisabled && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loginDisabled}
                activeOpacity={0.82}
              >
                {isLoading ? (
                  <ActivityIndicator color={colors.primaryContrast} />
                ) : (
                  <Text style={styles.buttonText}>{t("登录")}</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.registerLink} onPress={() => router.push("/register")}>
                <Text style={styles.registerText}>{t("创建新账户")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                style={styles.registerLink}
                onPress={() => router.push("/recovery")}
              >
                <Text style={styles.recoveryText}>{t("使用恢复码恢复账户")}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.securityPanel}>
            <View style={styles.securityPixel} accessible={false} />
            <Text style={styles.securityNote}>
              {t("主密码只在此设备上使用，不会发送到服务器")}
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
  pixel: {
    position: "absolute",
    width: 14,
    height: 14,
  },
  pixelTop: {
    top: 8,
    left: 8,
    backgroundColor: colors.primary,
  },
  pixelMiddle: {
    top: 21,
    left: 21,
    backgroundColor: colors.accent,
  },
  pixelBottom: {
    right: 8,
    bottom: 8,
    backgroundColor: colors.warning,
  },
  brand: {
    fontSize: fontSize.title,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    letterSpacing: 2.4,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    letterSpacing: 0.4,
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
  railPixel: {
    width: 8,
    height: 8,
  },
  railPrimary: { backgroundColor: colors.primary },
  railAccent: { backgroundColor: colors.accent },
  railWarning: { backgroundColor: colors.warning },
  railLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
  },
  form: {
    gap: spacing.sm,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    letterSpacing: 0.8,
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
    letterSpacing: 1,
  },
  registerLink: {
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  registerText: { color: colors.primary, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  recoveryText: { color: colors.textSecondary, fontSize: fontSize.bodySm },
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
