import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { copySensitiveToClipboard } from "@zero-vault/zero-vault-native";
import { useAuthState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";

export function RecoveryCodeScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    device,
    registrationRecoveryCode,
    clearRegistrationRecoveryCode,
    logout,
    error,
  } = useAuthState();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">("idle");

  useEffect(() => {
    const back = BackHandler.addEventListener("hardwareBackPress", () => true);
    const appState = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setIsConfirming(false);
        setCopyStatus("idle");
      }
    });
    return () => {
      back.remove();
      appState.remove();
    };
  }, []);

  const acknowledge = async () => {
    if (isAcknowledging) return;
    setIsAcknowledging(true);
    try {
      if (await clearRegistrationRecoveryCode()) {
        router.replace(device?.status === "approved" ? "/unlock" : "/device-approval");
      }
    } finally {
      setIsAcknowledging(false);
    }
  };

  const copyRecoveryCode = async () => {
    try {
      await copySensitiveToClipboard(registrationRecoveryCode ?? "", 30_000);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  const signInAgain = async () => {
    await logout();
    router.replace("/login");
  };

  if (!registrationRecoveryCode) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.pixelMark} accessible={false}>
              <View style={[styles.pixel, styles.pixelTop]} />
              <View style={[styles.pixel, styles.pixelMiddle]} />
              <View style={[styles.pixel, styles.pixelBottom]} />
            </View>
            <Text style={styles.title}>{t("恢复码已从屏幕清除")}</Text>
          </View>
          <View style={styles.card}>
            <View style={styles.pixelRail} accessible={false}>
              <View style={[styles.railPixel, styles.railWarning]} />
              <View style={[styles.railPixel, styles.railAccent]} />
              <View style={styles.railLine} />
            </View>
            <Text style={styles.body}>
              {t("为防止后台泄露，恢复码不会在当前会话中再次显示。请重新输入主密码登录；尚未确认的恢复码会从原生安全存储中重新显示。")}
            </Text>
            {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
            <TouchableOpacity accessibilityRole="button" style={styles.button} onPress={() => { void signInAgain(); }}>
              <Text style={styles.buttonText}>{t("退出并重新登录")}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.pixelMark} accessible={false}>
            <View style={[styles.pixel, styles.pixelTop]} />
            <View style={[styles.pixel, styles.pixelMiddle]} />
            <View style={[styles.pixel, styles.pixelBottom]} />
          </View>
          <Text style={styles.title}>{t("只显示一次的恢复码")}</Text>
        </View>
        <View style={styles.card}>
          <View style={styles.pixelRail} accessible={false}>
            <View style={[styles.railPixel, styles.railWarning]} />
            <View style={[styles.railPixel, styles.railAccent]} />
            <View style={styles.railLine} />
          </View>
          <Text style={styles.body}>
            {t("请现在抄写到纸上并离线保存。如需复制，请勿粘贴到聊天或云笔记。应用进入后台后会立即清除此码。")}
          </Text>
          <View style={styles.codeBox}>
            <Text testID="recovery-code-value" accessibilityLabel={t("账户恢复码")} style={styles.code}>{registrationRecoveryCode}</Text>
          </View>
          <TouchableOpacity
            testID="recovery-code-copy"
            accessibilityRole="button"
            accessibilityLabel={t("复制恢复码")}
            style={styles.secondaryButton}
            onPress={() => { void copyRecoveryCode(); }}
          >
            <View style={styles.iconLabel}>
              <SymbolView
                name={{ ios: "doc.on.doc", android: "content_copy", web: "content_copy" }}
                size={19}
                tintColor={colors.textSecondary}
              />
              <Text style={styles.secondaryText}>
                {copyStatus === "copied" ? t("已复制恢复码") : t("复制恢复码")}
              </Text>
            </View>
          </TouchableOpacity>
          {copyStatus !== "idle" ? (
            <Text
              accessibilityLiveRegion={copyStatus === "error" ? "assertive" : "polite"}
              style={[styles.copyFeedback, copyStatus === "error" && styles.copyError]}
            >
              {copyStatus === "copied" ? t("已复制到剪贴板") : t("复制失败，请重试")}
            </Text>
          ) : null}
          {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}

          {isConfirming ? (
            <View style={styles.confirmBox}>
              <Text style={styles.confirmText}>
                {t("确认已经离线保存？确认后原生安全存储会永久删除这份待确认恢复码，应用无法再次显示。")}
              </Text>
              <View style={styles.row}>
                <TouchableOpacity
                  accessibilityRole="button"
                  disabled={isAcknowledging}
                  style={[styles.secondaryButton, styles.flexButton]}
                  onPress={() => setIsConfirming(false)}
                >
                  <Text style={styles.secondaryText}>{t("返回检查")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  testID="recovery-code-acknowledge-confirm"
                  accessibilityRole="button"
                  accessibilityState={{ disabled: isAcknowledging }}
                  disabled={isAcknowledging}
                  style={[styles.button, styles.flexButton, isAcknowledging && styles.disabled]}
                  onPress={() => { void acknowledge(); }}
                >
                  {isAcknowledging
                    ? <ActivityIndicator color={colors.primaryContrast} />
                    : <Text style={styles.buttonText}>{t("确认已离线保存")}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              testID="recovery-code-acknowledge-start"
              accessibilityRole="button"
              style={styles.button}
              onPress={() => setIsConfirming(true)}
            >
              <Text style={styles.buttonText}>{t("我已抄写，继续确认")}</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
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
    maxWidth: 560,
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
  pixelTop: { top: 8, left: 8, backgroundColor: colors.warning },
  pixelMiddle: { top: 21, left: 21, backgroundColor: colors.primary },
  pixelBottom: { right: 8, bottom: 8, backgroundColor: colors.accent },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
    letterSpacing: 0.8,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.base,
    gap: spacing.md,
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
    marginBottom: spacing.xs,
  },
  railPixel: { width: 8, height: 8 },
  railWarning: { backgroundColor: colors.warning },
  railAccent: { backgroundColor: colors.accent },
  railLine: { flex: 1, height: 2, backgroundColor: colors.border },
  body: { color: colors.textSecondary, fontSize: fontSize.body, lineHeight: 24, textAlign: "center" },
  codeBox: {
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    padding: spacing.lg,
    borderStyle: "dashed",
  },
  code: {
    color: colors.textPrimary,
    fontFamily: "monospace",
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    lineHeight: 28,
    textAlign: "center",
  },
  copyFeedback: { color: colors.primary, fontSize: fontSize.bodySm, textAlign: "center" },
  copyError: { color: colors.danger },
  error: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    lineHeight: 20,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    padding: spacing.sm,
  },
  confirmBox: {
    borderWidth: 2,
    borderColor: colors.warning,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanelSoft,
    padding: spacing.md,
    gap: spacing.md,
  },
  confirmText: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21, textAlign: "center" },
  row: { flexDirection: "row", gap: spacing.sm },
  iconLabel: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  flexButton: { flex: 1 },
  button: {
    minHeight: minTouchTarget,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 3, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  buttonText: { color: colors.primaryContrast, fontWeight: fontWeight.semibold, textAlign: "center", letterSpacing: 0.6 },
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
  secondaryText: { color: colors.textSecondary, fontWeight: fontWeight.medium, textAlign: "center" },
  disabled: { opacity: 0.45, shadowOpacity: 0, elevation: 0 },
});
