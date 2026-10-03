import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { TrustedDevice } from "@zero-vault/shared";
import { useAuthState, useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

const STATUS_LABELS: Record<TrustedDevice["status"], string> = {
  pending: "等待批准",
  approved: "已信任",
  rejected: "已拒绝",
  revoked: "已撤销",
};

export function DevicesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language, t } = useI18n();
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const { csrfToken, device: currentDevice } = useAuthState();
  const {
    devices,
    isLocked,
    refreshDevices,
    approveDevice,
    rejectDevice,
    revokeDevice,
  } = useVaultState();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const actionRunningRef = useRef(false);

  const canManage = Boolean(
    csrfToken && currentDevice?.status === "approved" && !isLocked,
  );

  const refresh = useCallback(async () => {
    if (!canManage) return;
    setIsRefreshing(true);
    setMessage(null);
    try {
      await refreshDevices();
    } catch {
      setMessage("设备列表刷新失败，请检查网络后重试。");
    } finally {
      setIsRefreshing(false);
    }
  }, [canManage, refreshDevices]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runAction = useCallback(async (
    target: TrustedDevice,
    action: "approve" | "reject" | "revoke",
  ) => {
    if (!canManage || actionRunningRef.current) return;
    actionRunningRef.current = true;
    setPendingDeviceId(target.id);
    setMessage(null);
    try {
      if (action === "approve") await approveDevice(target.id);
      if (action === "reject") await rejectDevice(target.id);
      if (action === "revoke") await revokeDevice(target.id);
      await refreshDevices();
    } catch {
      setMessage("设备操作未完成。密码库和设备信任状态均未自动降级，请重试。");
    } finally {
      actionRunningRef.current = false;
      setPendingDeviceId(null);
    }
  }, [approveDevice, canManage, refreshDevices, rejectDevice, revokeDevice]);

  const confirmAction = useCallback((target: TrustedDevice, action: "approve" | "reject" | "revoke") => {
    const copy = action === "approve"
      ? {
          title: t("批准新设备？"),
          body: t(
            "仅在另一台设备上核对过以下指纹后继续：\n\n{fingerprint}\n\n批准后会为该设备加密分发密码库密钥。",
            { fingerprint: target.fingerprint ?? t("未提供指纹，禁止批准") },
          ),
          confirm: t("批准并共享密钥"),
        }
      : action === "reject"
        ? {
            title: t("拒绝此设备？"),
            body: t("“{name}”将无法获取密码库密钥。此操作不能在本页撤销。", {
              name: target.name,
            }),
            confirm: t("确认拒绝"),
          }
        : {
            title: t("撤销可信设备？"),
            body: t("“{name}”的移动会话和后续同步权限将被撤销。已离线的数据不会被远程擦除。", {
              name: target.name,
            }),
            confirm: t("确认撤销"),
          };

    if (action === "approve" && !target.fingerprint) {
      setMessage("该设备没有可核对的指纹，已阻止批准。");
      return;
    }

    Alert.alert(copy.title, copy.body, [
      { text: t("取消"), style: "cancel" },
      {
        text: copy.confirm,
        style: action === "approve" ? "default" : "destructive",
        onPress: () => { void runAction(target, action); },
      },
    ]);
  }, [runAction, t]);

  if (!canManage) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.gate}>
          <Text style={styles.title}>{t("可信设备")}</Text>
          <Text style={styles.gateText}>
            {!csrfToken || currentDevice?.status !== "approved"
              ? t("只有已批准且会话有效的设备可以管理信任关系。")
              : t("请先解锁密码库。批准设备需要在本机加密分发密码库密钥。")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={(
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => { void refresh(); }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.bgPanel}
          />
        )}
      >
        <Text style={styles.title}>{t("可信设备")}</Text>
        <Text style={styles.intro}>
          {t("批准前请在另一条可信信道核对完整指纹。撤销设备不会远程删除其离线副本。")}
        </Text>

        {message ? <Text accessibilityRole="alert" style={styles.error}>{t(message)}</Text> : null}

        {devices.length === 0 && !isRefreshing ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>
              {t("没有可显示的设备。下拉刷新后仍为空时，请停止操作并检查会话。")}
            </Text>
          </View>
        ) : null}

        {devices.map((trustedDevice) => {
          const isCurrent = trustedDevice.id === currentDevice?.id;
          const isPending = pendingDeviceId === trustedDevice.id;
          return (
            <View
              key={trustedDevice.id}
              style={styles.card}
              accessibilityLabel={t("设备 {name}", { name: trustedDevice.name })}
            >
              <View style={styles.headerRow}>
                <Text style={styles.deviceName}>{trustedDevice.name}</Text>
                <Text style={[
                  styles.status,
                  trustedDevice.status === "approved" && styles.statusApproved,
                  trustedDevice.status === "pending" && styles.statusPending,
                ]}>
                  {t(STATUS_LABELS[trustedDevice.status])}
                  {isCurrent ? ` · ${t("当前设备")}` : ""}
                </Text>
              </View>

              <Text style={styles.meta}>
                {t("注册时间：")}{formatDate(trustedDevice.createdAt, dateLocale, t("未知"))}
              </Text>
              <Text style={styles.meta}>
                {t("最近活动：")}{formatDate(trustedDevice.updatedAt, dateLocale, t("未知"))}
              </Text>
              {trustedDevice.lastSeenLocation ? (
                <Text style={styles.meta}>{t("最近位置：")}{trustedDevice.lastSeenLocation}</Text>
              ) : null}
              <Text selectable style={styles.fingerprint}>
                {t("指纹：")}{trustedDevice.fingerprint ?? t("未提供")}
              </Text>

              {isPending ? <ActivityIndicator color={colors.primary} style={styles.spinner} /> : null}

              {trustedDevice.status === "pending" ? (
                <View style={styles.actions}>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t("批准设备 {name}", { name: trustedDevice.name })}
                    accessibilityState={{ disabled: isPending || !trustedDevice.fingerprint }}
                    style={[styles.actionButton, styles.approveButton, (isPending || !trustedDevice.fingerprint) && styles.disabled]}
                    disabled={isPending || !trustedDevice.fingerprint}
                    onPress={() => confirmAction(trustedDevice, "approve")}
                  >
                    <Text style={styles.approveText}>{t("核对并批准")}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={t("拒绝设备 {name}", { name: trustedDevice.name })}
                    accessibilityState={{ disabled: isPending }}
                    style={[styles.actionButton, styles.dangerButton, isPending && styles.disabled]}
                    disabled={isPending}
                    onPress={() => confirmAction(trustedDevice, "reject")}
                  >
                    <Text style={styles.dangerText}>{t("拒绝")}</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {trustedDevice.status === "approved" && !isCurrent ? (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={t("撤销设备 {name}", { name: trustedDevice.name })}
                  accessibilityState={{ disabled: isPending }}
                  style={[styles.actionButton, styles.dangerButton, isPending && styles.disabled]}
                  disabled={isPending}
                  onPress={() => confirmAction(trustedDevice, "revoke")}
                >
                  <Text style={styles.dangerText}>{t("撤销此设备")}</Text>
                </TouchableOpacity>
              ) : null}

              {trustedDevice.status === "approved" && isCurrent ? (
                <Text style={styles.currentHint}>
                  {t("当前设备不能在此页自我撤销；请先退出，再由另一台可信设备撤销。")}
                </Text>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatDate(value: string, locale: string, unknownLabel: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? unknownLabel : date.toLocaleString(locale);
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.lg },
  gate: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase", borderLeftWidth: 6, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  intro: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.bgPanel, padding: spacing.sm },
  gateText: { color: colors.textSecondary, fontSize: fontSize.body, lineHeight: 24, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bgPanel, padding: spacing.base },
  error: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm, lineHeight: 20 },
  emptyCard: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.warning, padding: spacing.base, shadowColor: colors.warning, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20 },
  card: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.base, gap: spacing.sm, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.sm },
  deviceName: { flex: 1, color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.subheading, fontWeight: fontWeight.semibold, letterSpacing: 0.6 },
  status: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.xs, paddingVertical: 2 },
  statusApproved: { color: colors.success, borderColor: colors.success },
  statusPending: { color: colors.warning, borderColor: colors.warning },
  meta: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption },
  fingerprint: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.caption, lineHeight: 18, borderTopWidth: 2, borderTopColor: colors.border, paddingTop: spacing.sm },
  spinner: { marginVertical: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm },
  actionButton: { minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md, marginTop: spacing.xs, borderWidth: 2 },
  approveButton: { flex: 1, backgroundColor: colors.primary, borderColor: colors.primary, shadowColor: colors.borderStrong, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  dangerButton: { flex: 1, borderColor: colors.danger, backgroundColor: colors.bgRoot },
  approveText: { color: colors.primaryContrast, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  dangerText: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  currentHint: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption, lineHeight: 18 },
  disabled: { opacity: 0.45 },
  });
}
