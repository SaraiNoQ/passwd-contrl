import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";

export function RegisterScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { register, user, registrationRecoveryCode, isLoading, error, clearError } = useAuthState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const localError = password.length > 0 && password.length < 12
    ? "主密码至少需要 12 个字符"
    : confirm.length > 0 && password !== confirm ? "两次密码不一致" : null;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") { setPassword(""); setConfirm(""); }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (user && registrationRecoveryCode) router.replace("/recovery-code");
  }, [registrationRecoveryCode, router, user]);

  const submit = useCallback(async () => {
    clearError();
    try {
      await register(email, password);
    } finally {
      setPassword("");
      setConfirm("");
    }
  }, [clearError, email, password, register]);

  const registerDisabled = isLoading || Boolean(localError) || !email.trim() || !password || !confirm;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={styles.pixelMark} accessible={false}>
              <View style={[styles.pixel, styles.pixelTop]} />
              <View style={[styles.pixel, styles.pixelMiddle]} />
              <View style={[styles.pixel, styles.pixelBottom]} />
            </View>
            <Text style={styles.title}>{t("创建 Zero Vault")}</Text>
            <Text style={styles.subtitle}>{t("首台设备会成为可信设备。主密码和恢复码不会发送到服务器。")}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.pixelRail} accessible={false}>
              <View style={[styles.railPixel, styles.railPrimary]} />
              <View style={[styles.railPixel, styles.railAccent]} />
              <View style={[styles.railPixel, styles.railWarning]} />
              <View style={styles.railLine} />
            </View>

            <Text style={styles.label}>{t("邮箱")}</Text>
            <TextInput
              testID="register-email"
              accessibilityLabel={t("邮箱")}
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={t("邮箱")}
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />

            <Text style={styles.label}>{t("主密码（至少 12 位）")}</Text>
            <TextInput
              testID="register-password"
              accessibilityLabel={t("主密码（至少 12 位）")}
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder={t("主密码（至少 12 位）")}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoComplete="new-password"
            />

            <Text style={styles.label}>{t("再次输入主密码")}</Text>
            <TextInput
              testID="register-password-confirm"
              accessibilityLabel={t("再次输入主密码")}
              style={styles.input}
              value={confirm}
              onChangeText={setConfirm}
              placeholder={t("再次输入主密码")}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoComplete="new-password"
            />

            {localError || error ? (
              <Text accessibilityRole="alert" style={styles.error}>{t(localError ?? error ?? "")}</Text>
            ) : null}

            <TouchableOpacity
              testID="register-submit"
              accessibilityRole="button"
              accessibilityState={{ disabled: registerDisabled }}
              style={[styles.primary, registerDisabled && styles.disabled]}
              disabled={registerDisabled}
              activeOpacity={0.82}
              onPress={submit}
            >
              {isLoading ? <ActivityIndicator color={colors.primaryContrast} /> : <Text style={styles.primaryText}>{t("创建账户")}</Text>}
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" style={styles.secondary} onPress={() => router.replace("/login")}>
              <Text style={styles.secondaryText}>{t("已有账户，返回登录")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: {
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
  pixelTop: { top: 8, right: 8, backgroundColor: colors.primary },
  pixelMiddle: { top: 21, right: 21, backgroundColor: colors.accent },
  pixelBottom: { left: 8, bottom: 8, backgroundColor: colors.warning },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
    letterSpacing: 0.8,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
    lineHeight: 21,
    textAlign: "center",
    marginTop: spacing.sm,
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
    gap: spacing.sm,
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
    marginBottom: spacing.sm,
  },
  railPixel: { width: 8, height: 8 },
  railPrimary: { backgroundColor: colors.primary },
  railAccent: { backgroundColor: colors.accent },
  railWarning: { backgroundColor: colors.warning },
  railLine: { flex: 1, height: 2, backgroundColor: colors.border },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xs,
    letterSpacing: 0.6,
  },
  input: {
    minHeight: minTouchTarget,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.textPrimary,
    fontSize: fontSize.body,
  },
  error: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    lineHeight: 20,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    padding: spacing.sm,
  },
  primary: {
    minHeight: minTouchTarget,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginTop: spacing.sm,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  primaryText: {
    color: colors.primaryContrast,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
  },
  disabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
  secondary: {
    minHeight: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  secondaryText: { color: colors.primary, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
});
