import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Alert,
  AppState,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthState, useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, radius, spacing, type ThemeColors } from "../theme/tokens";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

export function DeviceApprovalScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const {
    user,
    device,
    registrationRecoveryCode,
    refreshDevice,
    logout,
    beginTrustedDeviceRebind,
    error,
  } = useAuthState();
  const vault = useVaultState();
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      await vault.refreshLocalDeviceSecurityState();
      const current = await refreshDevice();
      if (current?.status === "approved") router.replace("/unlock");
      if (current?.status === "rejected" || current?.status === "revoked") {
        await logout();
        router.replace("/login");
      }
    } finally {
      refreshingRef.current = false;
    }
  }, [logout, refreshDevice, router, vault.refreshLocalDeviceSecurityState]);

  useEffect(() => {
    if (!user) router.replace("/login");
    else if (registrationRecoveryCode) router.replace("/recovery-code");
  }, [registrationRecoveryCode, router, user]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") void refresh();
    }, 5_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const rebind = useCallback(() => {
    Alert.alert(
      t("重新创建设备身份？"),
      t("当前会话和本机设备身份将被销毁。重新登录后，需要在另一台可信设备上核对新指纹。"),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("销毁并重新绑定"),
          style: "destructive",
          onPress: () => {
            void beginTrustedDeviceRebind().then((reset) => {
              if (reset) {
                vault.lock();
                router.replace("/login");
              }
            });
          },
        },
      ],
    );
  }, [beginTrustedDeviceRebind, router, t, vault]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.statusMark} accessible={false}>
            <View style={[styles.statusPixel, styles.statusPixelTop]} />
            <View style={[styles.statusPixel, styles.statusPixelBottom]} />
            <ActivityIndicator color={colors.primary} size="small" />
          </View>
          <Text style={styles.title}>{t("等待设备批准")}</Text>
          <Text style={styles.body}>
            {t("请在一台已受信任设备中核对指纹并批准此设备。批准前，本机不能读取密码库或恢复包。")}
          </Text>
        </View>

        <View style={styles.card}>
          <View style={styles.pixelRail} accessible={false}>
            <View style={[styles.railPixel, styles.railPrimary]} />
            <View style={[styles.railPixel, styles.railAccent]} />
            <View style={[styles.railPixel, styles.railWarning]} />
            <View style={styles.railLine} />
          </View>
          {vault.localDeviceSecurityState?.fingerprint ? (
            <Text testID="device-approval-fingerprint" selectable style={styles.fingerprint}>
              {t("本机设备指纹：{fingerprint}", {
                fingerprint: vault.localDeviceSecurityState.fingerprint,
              })}
            </Text>
          ) : (
            <Text accessibilityRole="alert" style={styles.error}>
              {t("无法读取本机设备指纹，请勿批准此设备。")}
            </Text>
          )}
          {device ? (
            <Text selectable style={styles.deviceId}>
              {t("设备 ID：{id}", { id: device.id })}
            </Text>
          ) : null}
          {error || vault.error ? (
            <Text accessibilityRole="alert" style={styles.error}>{t(error ?? vault.error ?? "")}</Text>
          ) : null}
          {vault.localDeviceSecurityFailure === "RECOVERY_REQUIRED" ? (
            <>
              <TouchableOpacity
                testID="device-approval-recovery"
                accessibilityRole="button"
                style={styles.secondaryButton}
                onPress={() => { vault.lock(); router.push("/recovery"); }}
              >
                <Text style={styles.secondaryText}>{t("使用恢复码恢复")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="device-approval-rebind"
                accessibilityRole="button"
                style={styles.dangerButton}
                onPress={rebind}
              >
                <Text style={styles.dangerText}>{t("销毁本机身份并重新绑定")}</Text>
              </TouchableOpacity>
            </>
          ) : null}
          <TouchableOpacity accessibilityRole="button" style={styles.primaryButton} onPress={refresh}>
            <Text style={styles.primaryText}>{t("刷新状态")}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            style={styles.secondaryButton}
            onPress={async () => { if (await logout()) router.replace("/login"); }}
          >
            <Text style={styles.secondaryText}>{t("退出登录")}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
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
  statusMark: {
    width: 58,
    height: 58,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  statusPixel: { position: "absolute", width: 10, height: 10 },
  statusPixelTop: { top: 5, left: 5, backgroundColor: colors.accent },
  statusPixelBottom: { right: 5, bottom: 5, backgroundColor: colors.warning },
  title: {
    color: colors.textPrimary,
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    textAlign: "center",
    letterSpacing: 0.8,
  },
  body: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    lineHeight: 24,
    textAlign: "center",
    marginTop: spacing.sm,
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
  railPrimary: { backgroundColor: colors.primary },
  railAccent: { backgroundColor: colors.accent },
  railWarning: { backgroundColor: colors.warning },
  railLine: { flex: 1, height: 2, backgroundColor: colors.border },
  fingerprint: {
    color: colors.textPrimary,
    backgroundColor: colors.bgPanelSoft,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
    fontFamily: "monospace",
    fontSize: fontSize.bodySm,
    lineHeight: 22,
    textAlign: "center",
  },
  deviceId: {
    color: colors.textMuted,
    backgroundColor: colors.bgPanelSoft,
    padding: spacing.sm,
    fontFamily: "monospace",
    fontSize: fontSize.caption,
    lineHeight: 18,
    textAlign: "center",
  },
  error: {
    color: colors.danger,
    backgroundColor: colors.bgPanelSoft,
    borderLeftWidth: 4,
    borderLeftColor: colors.danger,
    padding: spacing.sm,
    fontSize: fontSize.bodySm,
    lineHeight: 20,
  },
  primaryButton: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
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
  secondaryButton: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  secondaryText: { color: colors.textSecondary, fontSize: fontSize.body, fontWeight: fontWeight.medium },
  dangerButton: {
    minHeight: minTouchTarget,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.danger,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
  },
  dangerText: { color: colors.danger, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium, textAlign: "center" },
  });
}
