import { useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius, fontSize, fontWeight, minTouchTarget } from "../theme/tokens";
import { useVaultState } from "../state/vault-state";

export function SyncStatusScreen() {
  const router = useRouter();
  const { lastSyncedAt, isSyncing, sync, conflictCount } = useVaultState();

  const handleSync = useCallback(() => {
    sync();
  }, [sync]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.content}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Text style={styles.backText}>← 返回</Text>
        </TouchableOpacity>

        <Text style={styles.title}>同步状态</Text>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>最近同步时间</Text>
          <Text style={styles.cardValue}>
            {lastSyncedAt
              ? new Date(lastSyncedAt).toLocaleString("zh-CN")
              : "从未同步"}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>同步状态</Text>
          <Text style={[styles.cardValue, isSyncing && styles.syncingText]}>
            {isSyncing ? "同步中..." : "空闲"}
          </Text>
        </View>

        {conflictCount > 0 ? (
          <View style={[styles.card, styles.conflictCard]}>
            <Text style={styles.conflictLabel}>冲突提示</Text>
            <Text style={styles.conflictText}>
              检测到 {conflictCount} 个冲突，请在 Web 端处理
            </Text>
          </View>
        ) : null}

        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.buttonDisabled]}
          onPress={handleSync}
          disabled={isSyncing}
          activeOpacity={0.8}
        >
          {isSyncing ? (
            <ActivityIndicator color={colors.bgRoot} />
          ) : (
            <Text style={styles.syncButtonText}>立即同步</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  content: {
    flex: 1,
    padding: spacing.base,
    gap: spacing.md,
  },
  backButton: {
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  backText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.base,
  },
  cardLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  cardValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: fontWeight.medium,
  },
  syncingText: {
    color: colors.primary,
  },
  conflictCard: {
    borderColor: colors.warning,
  },
  conflictLabel: {
    fontSize: fontSize.bodySm,
    color: colors.warning,
    fontWeight: fontWeight.semibold,
    marginBottom: spacing.xs,
  },
  conflictText: {
    fontSize: fontSize.bodySm,
    color: colors.textSecondary,
  },
  syncButton: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: minTouchTarget,
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  syncButtonText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.bgRoot,
  },
});
