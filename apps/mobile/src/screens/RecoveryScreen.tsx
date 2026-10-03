import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { copySensitiveToClipboard } from "@zero-vault/zero-vault-native";
import { useAuthState, useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";

export function RecoveryScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { csrfToken, device, recoverAccount, error: authError, clearError } = useAuthState();
  const {
    isLocked,
    rotateRecoveryCode,
    acknowledgeRecoveryCode,
    lock: lockVault,
    error: vaultError,
  } = useVaultState();
  const [email, setEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [rotatedCode, setRotatedCode] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [rotatedCopyStatus, setRotatedCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const operationRef = useRef<"restore" | "rotate" | null>(null);

  const clearPlaintext = useCallback(() => {
    setEmail("");
    setRecoveryCode("");
    setNewPassword("");
    setConfirmPassword("");
    setRotatedCode(null);
    setRotatedCopyStatus("idle");
    setConfirmRestore(false);
    setConfirmRotate(false);
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") clearPlaintext();
    });
    return () => subscription.remove();
  }, [clearPlaintext]);

  const performRestore = useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const code = recoveryCode.trim();
    if (!normalizedEmail || !code || newPassword.length < 12 || newPassword !== confirmPassword || operationRef.current) return;
    operationRef.current = "restore";
    setIsRestoring(true);
    setMessage(null);
    clearError();
    lockVault();
    try {
      const restored = await recoverAccount(normalizedEmail, code, newPassword);
      if (!restored) {
        setMessage("恢复失败。邮箱、恢复码或加密恢复材料无效；请不要删除本机待确认材料。");
        return;
      }
      setRecoveryCode("");
      setNewPassword("");
      setConfirmPassword("");
      router.replace("/recovery-code");
    } catch {
      setMessage("恢复失败。邮箱、恢复码或加密恢复材料无效；请使用新主密码尝试普通登录以确认状态。");
    } finally {
      operationRef.current = null;
      setRecoveryCode("");
      setConfirmRestore(false);
      setIsRestoring(false);
    }
  }, [clearError, confirmPassword, email, lockVault, newPassword, recoverAccount, recoveryCode, router]);

  const rotate = useCallback(async () => {
    if (!csrfToken || device?.status !== "approved" || isLocked || operationRef.current) return;
    operationRef.current = "rotate";
    setIsRotating(true);
    setRotatedCode(null);
    setRotatedCopyStatus("idle");
    setMessage(null);
    try {
      const nextCode = await rotateRecoveryCode();
      if (!nextCode.trim()) throw new Error("empty_recovery_code");
      setRotatedCode(nextCode);
    } catch {
      setMessage("恢复码轮换状态无法确认。请重试；应用会复用本机已保护的待确认材料。");
    } finally {
      operationRef.current = null;
      setConfirmRotate(false);
      setIsRotating(false);
    }
  }, [csrfToken, device?.status, isLocked, rotateRecoveryCode]);

  const acknowledgeRotatedCode = useCallback(async () => {
    if (operationRef.current) return;
    operationRef.current = "rotate";
    try {
      if (await acknowledgeRecoveryCode()) {
        setRotatedCode(null);
        setRotatedCopyStatus("idle");
        setMessage("新恢复码已从本机待确认存储中删除。");
      }
    } finally {
      operationRef.current = null;
    }
  }, [acknowledgeRecoveryCode]);

  const copyRotatedCode = useCallback(async () => {
    if (!rotatedCode) return;
    try {
      await copySensitiveToClipboard(rotatedCode, 30_000);
      setRotatedCopyStatus("copied");
    } catch {
      setRotatedCopyStatus("error");
    }
  }, [rotatedCode]);

  const canRotate = Boolean(csrfToken && device?.status === "approved" && !isLocked);
  const validRecoveryCode = /^[A-Za-z0-9_-]{43}$/u.test(recoveryCode.trim());
  const passwordError = newPassword.length > 0 && newPassword.length < 12
    ? "新主密码至少需要 12 个字符"
    : confirmPassword.length > 0 && newPassword !== confirmPassword
      ? "两次输入的新主密码不一致"
      : null;
  const validRestoreInput = email.trim().includes("@") && validRecoveryCode &&
    newPassword.length >= 12 && newPassword === confirmPassword;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.pageHeader}>
            <View style={styles.pixelMark} accessible={false}>
              <View style={[styles.pixel, styles.pixelTop]} />
              <View style={[styles.pixel, styles.pixelMiddle]} />
              <View style={[styles.pixel, styles.pixelBottom]} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{t("密码库恢复")}</Text>
              <Text style={styles.intro}>
                {t("恢复码只在本页内存中短暂使用；离开应用或进入后台会立即清空输入和新恢复码。")}
              </Text>
            </View>
          </View>

          {message || authError || vaultError ? (
            <Text accessibilityRole="alert" style={styles.message}>{t(message ?? authError ?? vaultError ?? "")}</Text>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("使用离线恢复码")}</Text>
            <Text style={styles.help}>{t("恢复会替换本机现有的密码库密钥材料。服务器不会收到恢复码明文。")}</Text>

            <Text style={styles.label}>{t("账户邮箱")}</Text>
            <TextInput
              testID="recovery-email"
              accessibilityLabel={t("恢复账户邮箱")}
              style={styles.input}
              value={email}
              onChangeText={(value) => { setEmail(value); setConfirmRestore(false); }}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
            />

            <Text style={styles.label}>{t("新主密码")}</Text>
            <TextInput
              testID="recovery-new-password"
              accessibilityLabel={t("新主密码")}
              style={styles.input}
              value={newPassword}
              onChangeText={(value) => { setNewPassword(value); setConfirmRestore(false); }}
              placeholder={t("至少 12 个字符")}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              importantForAutofill="no"
            />

            <Text style={styles.label}>{t("再次输入新主密码")}</Text>
            <TextInput
              testID="recovery-new-password-confirm"
              accessibilityLabel={t("再次输入新主密码")}
              style={styles.input}
              value={confirmPassword}
              onChangeText={(value) => { setConfirmPassword(value); setConfirmRestore(false); }}
              placeholder={t("再次输入新主密码")}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              importantForAutofill="no"
            />
            {passwordError ? <Text accessibilityRole="alert" style={styles.inputError}>{t(passwordError)}</Text> : null}

            <Text style={styles.label}>{t("恢复码")}</Text>
            <TextInput
              testID="recovery-code"
              accessibilityLabel={t("离线恢复码")}
              style={[styles.input, styles.codeInput]}
              value={recoveryCode}
              onChangeText={(value) => { setRecoveryCode(value); setConfirmRestore(false); }}
              placeholder={t("输入离线保存的恢复码")}
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              importantForAutofill="no"
            />

            {!confirmRestore ? (
              <TouchableOpacity
                testID="recovery-continue"
                accessibilityRole="button"
                accessibilityState={{ disabled: !validRestoreInput || isRestoring }}
                style={[styles.primaryButton, (!validRestoreInput || isRestoring) && styles.disabled]}
                disabled={!validRestoreInput || isRestoring}
                onPress={() => setConfirmRestore(true)}
              >
                <Text style={styles.primaryText}>{t("继续恢复")}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>{t("确认重置主密码并重建设备信任？成功后所有旧会话、旧设备和旧恢复码都会失效。恢复码错误时操作会安全失败。")}</Text>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.secondaryButton, styles.flexButton]}
                    disabled={isRestoring}
                    onPress={() => setConfirmRestore(false)}
                  >
                    <Text style={styles.secondaryText}>{t("取消")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID="recovery-confirm"
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isRestoring }}
                    style={[styles.dangerFilledButton, styles.flexButton, isRestoring && styles.disabled]}
                    disabled={isRestoring}
                    onPress={() => { void performRestore(); }}
                  >
                    {isRestoring
                      ? <ActivityIndicator color={colors.primaryContrast} />
                      : <Text style={styles.dangerFilledText}>{t("确认替换并恢复")}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t("轮换恢复码")}</Text>
            <Text style={styles.help}>{t("轮换成功后旧恢复码立即失效。新恢复码只显示到你确认保存或应用进入后台。")}</Text>

            {rotatedCode ? (
              <View style={styles.oneTimeBox}>
                <Text style={styles.oneTimeLabel}>{t("只显示一次")}</Text>
                <Text style={styles.rotatedCode}>{rotatedCode}</Text>
                <Text style={styles.help}>{t("请抄写到纸上并离线保存，不要截图或粘贴到云笔记。")}</Text>
                <TouchableOpacity
                  testID="rotated-recovery-code-copy"
                  accessibilityRole="button"
                  accessibilityLabel={t("复制恢复码")}
                  style={styles.secondaryButton}
                  onPress={() => { void copyRotatedCode(); }}
                >
                  <Text style={styles.secondaryText}>
                    {rotatedCopyStatus === "copied" ? t("已复制恢复码") : t("复制恢复码")}
                  </Text>
                </TouchableOpacity>
                {rotatedCopyStatus !== "idle" ? (
                  <Text
                    accessibilityLiveRegion={rotatedCopyStatus === "error" ? "assertive" : "polite"}
                    style={[
                      styles.copyFeedback,
                      rotatedCopyStatus === "error" && styles.copyError,
                    ]}
                  >
                    {rotatedCopyStatus === "copied" ? t("已复制到剪贴板") : t("复制失败，请重试")}
                  </Text>
                ) : null}
                <TouchableOpacity
                  accessibilityRole="button"
                  style={styles.primaryButton}
                  onPress={() => { void acknowledgeRotatedCode(); }}
                >
                  <Text style={styles.primaryText}>{t("我已离线保存")}</Text>
                </TouchableOpacity>
              </View>
            ) : confirmRotate ? (
              <View style={styles.confirmBox}>
                <Text style={styles.confirmText}>{t("确认生成新恢复码？服务器接受新恢复包后，旧恢复码会立即失效。")}</Text>
                <View style={styles.buttonRow}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    style={[styles.secondaryButton, styles.flexButton]}
                    disabled={isRotating}
                    onPress={() => setConfirmRotate(false)}
                  >
                    <Text style={styles.secondaryText}>{t("取消")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isRotating }}
                    style={[styles.dangerFilledButton, styles.flexButton, isRotating && styles.disabled]}
                    disabled={isRotating}
                    onPress={() => { void rotate(); }}
                  >
                    {isRotating
                      ? <ActivityIndicator color={colors.dangerContrast} />
                      : <Text style={styles.dangerFilledText}>{t("确认轮换")}</Text>}
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityState={{ disabled: !canRotate }}
                style={[styles.dangerOutlineButton, !canRotate && styles.disabled]}
                disabled={!canRotate}
                onPress={() => setConfirmRotate(true)}
              >
                <Text style={styles.dangerText}>{t("生成新恢复码并使旧码失效")}</Text>
              </TouchableOpacity>
            )}

            {!canRotate && !rotatedCode ? (
              <Text style={styles.gateText}>{t("轮换需要有效会话、已批准设备和已解锁的密码库。")}</Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    padding: spacing.base,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  pixelMark: {
    width: 50,
    height: 50,
    flexShrink: 0,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSoft,
  },
  pixel: { position: "absolute", width: 10, height: 10 },
  pixelTop: { top: 6, left: 6, backgroundColor: colors.warning },
  pixelMiddle: { top: 18, left: 18, backgroundColor: colors.primary },
  pixelBottom: { right: 6, bottom: 6, backgroundColor: colors.accent },
  headerCopy: { flex: 1, gap: spacing.xs },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
  },
  intro: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21 },
  message: {
    color: colors.warning,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.warning,
    padding: spacing.sm,
    fontSize: fontSize.bodySm,
    lineHeight: 20,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.base,
    gap: spacing.sm,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 0.8,
    shadowRadius: 0,
    elevation: 3,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: fontSize.subheading,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.5,
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
    paddingBottom: spacing.xs,
  },
  help: { color: colors.textMuted, fontSize: fontSize.caption, lineHeight: 18 },
  label: {
    color: colors.textSecondary,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xs,
    letterSpacing: 0.4,
  },
  input: {
    minHeight: minTouchTarget,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    fontSize: fontSize.body,
  },
  codeInput: { fontFamily: "monospace" },
  inputError: {
    color: colors.danger,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    padding: spacing.sm,
    fontSize: fontSize.caption,
    lineHeight: 18,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  primaryText: {
    color: colors.primaryContrast,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
  },
  confirmBox: {
    borderWidth: 2,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSoft,
    padding: spacing.md,
    gap: spacing.sm,
  },
  confirmText: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20 },
  buttonRow: { flexDirection: "row", gap: spacing.sm },
  flexButton: { flex: 1 },
  secondaryButton: {
    minHeight: minTouchTarget,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: colors.textSecondary, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  dangerFilledButton: {
    minHeight: minTouchTarget,
    backgroundColor: colors.danger,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  dangerFilledText: { color: colors.dangerContrast, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, textAlign: "center" },
  dangerOutlineButton: {
    minHeight: minTouchTarget,
    borderWidth: 2,
    borderColor: colors.danger,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  dangerText: { color: colors.danger, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, textAlign: "center" },
  oneTimeBox: {
    borderWidth: 2,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    borderStyle: "dashed",
    backgroundColor: colors.bgPanelSoft,
    padding: spacing.md,
    gap: spacing.md,
  },
  oneTimeLabel: { color: colors.warning, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, textAlign: "center" },
  rotatedCode: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, lineHeight: 26, textAlign: "center" },
  copyFeedback: { color: colors.primary, fontSize: fontSize.caption, lineHeight: 18, textAlign: "center" },
  copyError: { color: colors.danger },
  gateText: { color: colors.textMuted, fontSize: fontSize.caption, lineHeight: 18 },
  disabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
});
