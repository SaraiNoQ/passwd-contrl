import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import type { CloudExportMetadata } from "@zero-vault/shared";
import { useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

export function CloudBackupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language, t } = useI18n();
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const vault = useVaultState();
  const [backups, setBackups] = useState<CloudExportMetadata[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setError("");
    try {
      setBackups(await vault.listCloudBackups());
    } catch (cause) {
      setError(messageFor(cause));
    }
  }, [vault.listCloudBackups]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setBackups(await vault.createCloudBackup());
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, [vault.createCloudBackup]);

  const restore = useCallback((backup: CloudExportMetadata) => {
    Alert.alert(
      t("恢复加密备份"),
      t("本机 Room 密文库和待同步队列将被此快照原子替换，完成后密码库会立即锁定。是否继续？"),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("恢复"),
          style: "destructive",
          onPress: () => {
            setBusy(true);
            setError("");
            void vault.restoreCloudBackup(backup.id)
              .then(() => router.replace("/unlock"))
              .catch((cause) => setError(messageFor(cause)))
              .finally(() => setBusy(false));
          },
        },
      ],
    );
  }, [router, t, vault.restoreCloudBackup]);

  const remove = useCallback((backup: CloudExportMetadata) => {
    Alert.alert(t("删除云端备份"), t("此操作只删除服务器上的加密快照，无法撤销。"), [
      { text: t("取消"), style: "cancel" },
      {
        text: t("删除"),
        style: "destructive",
        onPress: () => {
          setBusy(true);
          setError("");
          void vault.deleteCloudBackup(backup.id)
            .then(setBackups)
            .catch((cause) => setError(messageFor(cause)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }, [t, vault.deleteCloudBackup]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t("加密云备份")}</Text>
        <Text style={styles.description}>
          {t("快照由 Android 原生层直接从 Room 生成，只包含版本化密文封装、密文待同步队列和同步游标；服务器不会解析内容。")}
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
        <TouchableOpacity
          accessibilityRole="button"
          testID="cloud-backup-create"
          disabled={busy || vault.isLocked || vault.conflictCount > 0}
          style={[styles.primary, (busy || vault.isLocked || vault.conflictCount > 0) && styles.disabled]}
          onPress={() => { void create(); }}
        >
          <Text style={styles.primaryText}>{busy ? t("处理中…") : t("创建加密快照")}</Text>
        </TouchableOpacity>
        {vault.isLocked ? <Text style={styles.hint}>{t("创建和恢复前必须先解锁密码库。")}</Text> : null}
        {vault.conflictCount > 0 ? <Text style={styles.hint}>{t("请先处理同步冲突，再创建一致性快照。")}</Text> : null}

        {backups.length === 0 ? (
          <Text style={styles.empty} testID="cloud-backup-empty">{t("暂无兼容的移动端云备份。")}</Text>
        ) : backups.map((backup) => (
          <View key={backup.id} style={styles.card} testID={`cloud-backup-${backup.id}`}>
            <Text style={styles.cardTitle}>{new Date(backup.createdAt).toLocaleString(dateLocale)}</Text>
            <Text style={styles.meta}>{formatBytes(backup.size)} · {t("移动端认证密文快照 v2")}</Text>
            <View style={styles.actions}>
              <TouchableOpacity
                accessibilityRole="button"
                testID="cloud-backup-restore"
                disabled={busy || vault.isLocked}
                style={styles.action}
                onPress={() => restore(backup)}
              >
                <Text style={styles.actionText}>{t("恢复")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityRole="button"
                testID="cloud-backup-delete"
                disabled={busy}
                style={styles.action}
                onPress={() => remove(backup)}
              >
                <Text style={styles.dangerText}>{t("删除")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function messageFor(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code: unknown }).code)
    : cause instanceof Error ? cause.message : "unknown";
  const messages: Record<string, string> = {
    BACKUP_CONFLICTS_PRESENT: "存在未解决的同步冲突，未创建备份。",
    cloud_backup_incompatible: "该快照不是兼容的移动端密文格式，已拒绝恢复。",
    encrypted_backup_invalid: "云端密文快照无效，未修改本机数据。",
    unauthorized: "登录会话已失效，请重新登录。",
    network_error: "网络连接失败，请稍后重试。",
  };
  return messages[code] ?? "云备份操作失败，未执行不安全降级。";
}

function formatBytes(value: number): string {
  return value < 1_048_576 ? `${Math.ceil(value / 1024)} KiB` : `${(value / 1_048_576).toFixed(1)} MiB`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.sm },
  title: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 1.4, textTransform: "uppercase", borderLeftWidth: 6, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  description: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21, marginBottom: spacing.md },
  error: { color: colors.danger, fontFamily: "monospace", marginBottom: spacing.sm },
  primary: { minHeight: minTouchTarget, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", marginBottom: spacing.xs, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  primaryText: { color: colors.primaryContrast, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },
  disabled: { opacity: 0.45 },
  hint: { color: colors.warning, fontFamily: "monospace", fontSize: fontSize.caption, marginBottom: spacing.xs },
  empty: { color: colors.textMuted, fontFamily: "monospace", textAlign: "center", marginTop: spacing.xl },
  card: { padding: spacing.md, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bgPanel, marginTop: spacing.md, shadowColor: colors.borderStrong, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  cardTitle: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  meta: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1, minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bgRoot },
  actionText: { color: colors.primary, fontFamily: "monospace", fontWeight: fontWeight.semibold },
  dangerText: { color: colors.danger, fontFamily: "monospace", fontWeight: fontWeight.semibold },
  });
}
