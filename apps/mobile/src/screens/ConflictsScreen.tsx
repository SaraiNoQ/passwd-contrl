import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthState, useVaultState } from "../state/app-state";
import type {
  VaultConflictItemSummary,
  VaultConflictVersionPreview,
  VaultConflictView,
} from "../state/vault-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";

type Resolution = "local" | "server" | "duplicate" | "skip";

const REASON_LABELS: Record<VaultConflictView["reason"], string> = {
  invalid_server_revision: "同步基线已变化",
  item_revision_advanced: "云端条目已更新",
  item_revision_mismatch: "条目版本不一致",
  item_owner_mismatch: "所有者校验失败",
  mutation_id_reused: "变更标识重复",
};

export function ConflictsScreen() {
  const { language, t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const { csrfToken, device } = useAuthState();
  const { conflicts, isLocked, resolveConflict } = useVaultState();
  const [confirming, setConfirming] = useState<{ itemId: string; resolution: Resolution } | null>(null);
  const [resolvingItemId, setResolvingItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const resolutionRunningRef = useRef(false);

  const canResolve = Boolean(csrfToken && device?.status === "approved" && !isLocked);

  useEffect(() => {
    if (!canResolve) {
      setConfirming(null);
      setMessage(null);
    }
  }, [canResolve]);

  const resolve = useCallback(async () => {
    if (!canResolve || !confirming || resolutionRunningRef.current) return;
    resolutionRunningRef.current = true;
    setResolvingItemId(confirming.itemId);
    setMessage(null);
    try {
      await resolveConflict(confirming.itemId, confirming.resolution);
      setConfirming(null);
    } catch {
      setMessage("冲突处理失败。系统没有静默覆盖任何版本，请重新同步后再试。");
    } finally {
      resolutionRunningRef.current = false;
      setResolvingItemId(null);
    }
  }, [canResolve, confirming, resolveConflict]);

  if (!canResolve) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.gate}>
          <Text style={styles.title}>{t("同步冲突")}</Text>
          <Text style={styles.body}>
            {!csrfToken || device?.status !== "approved"
              ? t("只有会话有效的可信设备可以处理同步冲突。")
              : t("请先解锁密码库。冲突决议需要读取本地密文并生成新的加密变更。")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView testID="conflicts-screen" style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("同步冲突")}</Text>
        <Text style={styles.body}>
          {t("每条冲突都需要明确选择。应用不会按时间戳静默覆盖本地或云端版本。")}
        </Text>
        <Text style={styles.body}>
          {t("安全预览不会显示密码、CVV、TOTP、笔记正文或任何自定义字段值。")}
        </Text>

        {message ? <Text accessibilityRole="alert" style={styles.error}>{t(message)}</Text> : null}

        {conflicts.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>{t("没有待处理冲突")}</Text>
            <Text style={styles.emptyText}>{t("本机当前没有需要人工仲裁的加密变更。")}</Text>
          </View>
        ) : null}

        {conflicts.map((conflict) => {
          const isResolving = resolvingItemId === conflict.itemId;
          const pendingChoice = confirming?.itemId === conflict.itemId ? confirming.resolution : null;
          return (
            <View key={conflict.itemId} testID={`conflict-${conflict.itemId}`} style={styles.card}>
              <View style={styles.headerRow}>
                <Text style={styles.reason}>{t(REASON_LABELS[conflict.reason])}</Text>
                <Text style={styles.operation}>
                  {t(conflict.operation === "upsert" ? "修改" : "删除")}
                </Text>
              </View>
              <Text selectable style={styles.itemId}>
                {t("条目 ID：{id}", { id: conflict.itemId })}
              </Text>
              <View style={styles.revisions}>
                <Text style={styles.meta}>
                  {t("本地基线：v{revision}", { revision: conflict.clientBaseRevision })}
                </Text>
                <Text style={styles.meta}>
                  {t("服务器：v{revision}", {
                    revision: conflict.serverItemRevision ?? conflict.serverRevision,
                  })}
                </Text>
              </View>
              <View style={styles.previews}>
                <VersionPreview label={t("本地版本")} locale={dateLocale} version={conflict.localVersion} />
                <VersionPreview label={t("云端版本")} locale={dateLocale} version={conflict.serverVersion} />
              </View>

              <View style={styles.actions}>
                <ResolutionButton
                  testID={`conflict-local-${conflict.itemId}`}
                  label={t("保留本地")}
                  disabled={isResolving}
                  onPress={() => setConfirming({ itemId: conflict.itemId, resolution: "local" })}
                />
                <ResolutionButton
                  testID={`conflict-server-${conflict.itemId}`}
                  label={t("采用云端")}
                  disabled={isResolving}
                  onPress={() => setConfirming({ itemId: conflict.itemId, resolution: "server" })}
                />
                {conflict.operation === "upsert" ? (
                  <ResolutionButton
                    testID={`conflict-duplicate-${conflict.itemId}`}
                    label={t("两者保留")}
                    disabled={isResolving}
                    onPress={() => setConfirming({ itemId: conflict.itemId, resolution: "duplicate" })}
                  />
                ) : null}
                <ResolutionButton
                  testID={`conflict-skip-${conflict.itemId}`}
                  label={t("稍后处理")}
                  disabled={isResolving}
                  onPress={() => setConfirming({ itemId: conflict.itemId, resolution: "skip" })}
                />
              </View>

              {pendingChoice ? (
                <View style={styles.confirmBox} accessibilityRole="alert">
                  <Text style={styles.confirmTitle}>
                    {t("确认{resolution}？", { resolution: t(resolutionLabel(pendingChoice)) })}
                  </Text>
                  <Text style={styles.confirmText}>
                    {t(resolutionDescription(pendingChoice, conflict.operation))}
                  </Text>
                  <View style={styles.confirmActions}>
                    <TouchableOpacity
                      testID={`conflict-cancel-${conflict.itemId}`}
                      accessibilityRole="button"
                      style={[styles.confirmButton, styles.cancelButton]}
                      disabled={isResolving}
                      onPress={() => setConfirming(null)}
                    >
                      <Text style={styles.cancelText}>{t("取消")}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      testID={`conflict-confirm-${conflict.itemId}`}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: isResolving }}
                      style={[styles.confirmButton, styles.commitButton, isResolving && styles.disabled]}
                      disabled={isResolving}
                      onPress={() => { void resolve(); }}
                    >
                      {isResolving
                        ? <ActivityIndicator color={colors.dangerContrast} />
                        : <Text style={styles.commitText}>{t("写入决议")}</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function ResolutionButton({ testID, label, disabled, onPress }: { testID: string; label: string; disabled: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <TouchableOpacity
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={[styles.resolutionButton, disabled && styles.disabled]}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={styles.resolutionText}>{label}</Text>
    </TouchableOpacity>
  );
}

function VersionPreview({
  label,
  locale,
  version,
}: {
  label: string;
  locale: string;
  version: VaultConflictVersionPreview;
}) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (version.kind !== "item") {
    return (
      <View style={styles.previewCard}>
        <Text style={styles.previewLabel}>{label}</Text>
        <Text style={version.kind === "unavailable" ? styles.previewWarning : styles.previewState}>
          {t(versionStateLabel(version))}
        </Text>
      </View>
    );
  }
  const { summary } = version;
  return (
    <View style={styles.previewCard}>
      <Text style={styles.previewLabel}>{label}</Text>
      <Text style={styles.previewTitle}>{summary.title}</Text>
      <Text style={styles.previewMeta}>
        {t(itemTypeLabel(summary.type))} · {t("更新于 {time}", {
          time: formatTimestamp(summary.updatedAt, locale, t("时间未知")),
        })}
      </Text>
      {summary.folder ? (
        <Text style={styles.previewDetail}>{t("文件夹：")}{summary.folder}</Text>
      ) : null}
      {summary.origin ? (
        <Text style={styles.previewDetail}>{t("网站：")}{summary.origin}</Text>
      ) : null}
      {summary.username ? (
        <Text style={styles.previewDetail}>{t("用户名：")}{summary.username}</Text>
      ) : null}
      {summary.cardholderName ? (
        <Text style={styles.previewDetail}>{t("持卡人：")}{summary.cardholderName}</Text>
      ) : null}
      {summary.brand ? (
        <Text style={styles.previewDetail}>{t("卡组织：")}{summary.brand}</Text>
      ) : null}
      {summary.cardLastFour ? (
        <Text style={styles.previewDetail}>{t("卡号末四位：")}{summary.cardLastFour}</Text>
      ) : null}
      {summary.customFieldCount > 0 ? (
        <Text style={styles.previewDetail}>
          {t("自定义字段：{count} 项（值不在预览中显示）", {
            count: summary.customFieldCount,
          })}
        </Text>
      ) : null}
    </View>
  );
}

function resolutionLabel(resolution: Resolution): string {
  if (resolution === "local") return "保留本地版本";
  if (resolution === "server") return "采用云端版本";
  if (resolution === "duplicate") return "将本地版本另存为副本";
  return "暂缓此冲突";
}

function resolutionDescription(resolution: Resolution, operation: VaultConflictView["operation"]): string {
  if (resolution === "local") {
    return operation === "delete"
      ? "本地删除将覆盖云端版本；云端条目内容会被删除。"
      : "本地内容将作为新的加密变更覆盖当前云端版本。";
  }
  if (resolution === "server") return "未同步的本地变更会被丢弃，并采用服务器当前状态。";
  if (resolution === "duplicate") return "云端版本保持为原条目，本地版本会使用新 ID 加密保存为副本。";
  return "本次不改写任何版本；该冲突会在下一次同步重试时再次出现。";
}

function versionStateLabel(version: Exclude<VaultConflictVersionPreview, { kind: "item" }>): string {
  if (version.kind === "deleted") return "已删除";
  if (version.kind === "missing") return "不存在（该版本没有密文记录）";
  if (version.reason === "ciphertext_missing") return "密文缺失，无法安全预览";
  if (version.reason === "invalid_ciphertext") return "密文元数据无效，无法安全预览";
  return "无法解密；密钥可能不匹配或密文已损坏";
}

function itemTypeLabel(type: VaultConflictItemSummary["type"]): string {
  if (type === "login") return "登录项";
  if (type === "secure_note") return "安全笔记";
  return "信用卡";
}

function formatTimestamp(value: string, locale: string, unknownLabel: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? unknownLabel : parsed.toLocaleString(locale);
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.md },
  gate: { flex: 1, justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  title: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase", borderLeftWidth: 6, borderLeftColor: colors.warning, paddingLeft: spacing.sm },
  body: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21 },
  error: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm, lineHeight: 20, borderLeftWidth: 4, borderLeftColor: colors.danger, paddingLeft: spacing.sm },
  emptyCard: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.success, padding: spacing.base, gap: spacing.xs, shadowColor: colors.success, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  emptyTitle: { color: colors.success, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  emptyText: { color: colors.textSecondary, fontSize: fontSize.bodySm },
  card: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.warning, padding: spacing.base, gap: spacing.sm, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  reason: { flex: 1, color: colors.warning, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  operation: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.caption, borderWidth: 2, borderColor: colors.borderStrong, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  itemId: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption },
  revisions: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, borderTopWidth: 2, borderTopColor: colors.border, paddingTop: spacing.sm },
  meta: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.caption },
  previews: { gap: spacing.sm },
  previewCard: { backgroundColor: colors.bgRoot, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, gap: spacing.xs },
  previewLabel: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.caption, fontWeight: fontWeight.semibold, letterSpacing: 0.7 },
  previewTitle: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  previewMeta: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption },
  previewDetail: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20 },
  previewState: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.bodySm },
  previewWarning: { color: colors.warning, fontFamily: "monospace", fontSize: fontSize.bodySm, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  resolutionButton: { minHeight: minTouchTarget, minWidth: 96, flexGrow: 1, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.bgRoot, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  resolutionText: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  confirmBox: { borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.bgRoot, padding: spacing.md, gap: spacing.sm, shadowColor: colors.danger, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  confirmTitle: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  confirmText: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20 },
  confirmActions: { flexDirection: "row", gap: spacing.sm },
  confirmButton: { flex: 1, minHeight: minTouchTarget, borderWidth: 2, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.sm },
  cancelButton: { borderColor: colors.borderStrong, backgroundColor: colors.bgPanel },
  commitButton: { backgroundColor: colors.danger, borderColor: colors.danger },
  cancelText: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  commitText: { color: colors.dangerContrast, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, letterSpacing: 0.5 },
  disabled: { opacity: 0.45 },
});
