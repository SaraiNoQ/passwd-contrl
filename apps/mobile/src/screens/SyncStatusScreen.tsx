import { useCallback, useMemo } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { spacing, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { useVaultState } from "../state/app-state";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";

export function SyncStatusScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language, t } = useI18n();
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const {
    lastSyncedAt,
    isSyncing,
    sync,
    conflictCount,
    pendingMutationCount,
    error,
  } = useVaultState();

  const handleSync = useCallback(() => {
    void sync();
  }, [sync]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>{t("← 返回")}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{t("同步状态")}</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t("最近同步时间")}</Text>
          <Text style={styles.cardValue}>
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleString(dateLocale)
              : t("从未同步")}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>{t("同步状态")}</Text>
          <Text style={[styles.cardValue, isSyncing && styles.syncingText]}>
            {isSyncing ? t("同步中...") : t("空闲")}
          </Text>
          <Text style={styles.pendingText}>
            {t("待同步 {count} 项", { count: pendingMutationCount })}
          </Text>
        </View>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}

        {conflictCount > 0 ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={t("处理 {count} 个同步冲突", { count: conflictCount })}
            style={[styles.card, styles.conflictCard]}
            onPress={() => router.push("/conflicts")}
          >
            <Text style={styles.conflictLabel}>{t("冲突提示")}</Text>
            <Text style={styles.conflictText}>
              {t("检测到 {count} 个冲突，点击选择处理方式", { count: conflictCount })}
            </Text>
          </TouchableOpacity>
        ) : null}

        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.buttonDisabled]}
          onPress={handleSync}
          disabled={isSyncing}
          activeOpacity={0.8}
        >
          {isSyncing ? (
            <ActivityIndicator color={colors.primaryContrast} />
          ) : (
            <Text style={styles.syncButtonText}>{t("立即同步")}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  content: {
    flex: 1,
    padding: spacing.base,
    paddingBottom: spacing.xl + spacing.base,
    gap: spacing.lg,
  },
  backButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    alignSelf: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: colors.primary,
  },
  backText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontFamily: "monospace",
    fontWeight: fontWeight.medium,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    fontFamily: "monospace",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    borderLeftWidth: 6,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    padding: spacing.base,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  cardLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontFamily: "monospace",
    letterSpacing: 0.7,
    marginBottom: spacing.sm,
  },
  cardValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontFamily: "monospace",
    fontWeight: fontWeight.medium,
  },
  syncingText: {
    color: colors.primary,
  },
  pendingText: {
    color: colors.textMuted,
    fontFamily: "monospace",
    fontSize: fontSize.caption,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontFamily: "monospace",
    fontSize: fontSize.bodySm,
  },
  conflictCard: {
    borderColor: colors.warning,
    shadowColor: colors.warning,
  },
  conflictLabel: {
    fontSize: fontSize.bodySm,
    color: colors.warning,
    fontFamily: "monospace",
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  conflictText: {
    fontSize: fontSize.bodySm,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  syncButton: {
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.primary,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.primaryContrast,
    fontFamily: "monospace",
    letterSpacing: 0.9,
  },
});
