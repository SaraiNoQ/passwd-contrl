import { useMemo } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { analyzePasswordHealth, type PasswordRiskReason } from "../lib/password-health";
import { useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

const reasonLabelKeys: Record<PasswordRiskReason, string> = {
  missing: "缺失密码",
  weak: "弱密码",
  reused: "重复使用",
};

export function PasswordHealthScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { items, isLocked } = useVaultState();
  const report = useMemo(() => analyzePasswordHealth(items), [items]);
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  if (isLocked) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.center}>
          <Text style={styles.muted}>{t("密码库已锁定，健康分析不可用")}</Text>
          <TouchableOpacity style={styles.button} onPress={() => router.replace("/unlock")}>
            <Text style={styles.buttonText}>{t("去解锁")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerBlock}>
          <Text style={styles.headerKicker}>{t("本机安全扫描")}</Text>
          <Text style={styles.screenTitle}>{t("密码健康")}</Text>
        </View>
        <Text style={styles.notice}>{t("分析仅在本机解锁内存中执行，不会上传或保存密码及其哈希。")}</Text>
        <View style={styles.summaryRow}>
          <Summary styles={styles} label={t("登录条目")} value={report.loginCount} />
          <Summary styles={styles} label={t("缺失")} value={report.missingCount} danger={report.missingCount > 0} />
          <Summary styles={styles} label={t("弱密码")} value={report.weakCount} danger={report.weakCount > 0} />
          <Summary styles={styles} label={t("复用")} value={report.reusedCount} danger={report.reusedCount > 0} />
        </View>

        {report.risks.length === 0 ? (
          <View style={styles.emptyCard}><Text style={styles.safe}>{t("未发现缺失、弱密码或重复使用风险")}</Text></View>
        ) : report.risks.map((risk) => {
          const item = itemsById.get(risk.itemId);
          if (!item) return null;
          return (
            <TouchableOpacity
              key={risk.itemId}
              accessibilityRole="button"
              accessibilityLabel={t("编辑 {title}", { title: item.title || t("未命名") })}
              style={styles.riskCard}
              onPress={() => router.push(`/item/${risk.itemId}/edit`)}
            >
              <Text style={styles.title}>{item.title || t("未命名")}</Text>
              <View style={styles.tags}>
                {risk.reasons.map((reason) => <Text key={reason} style={styles.tag}>{t(reasonLabelKeys[reason])}</Text>)}
              </View>
              <Text style={styles.link}>{t("前往修改")}　›</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function Summary({ label, value, danger = false, styles }: { label: string; value: number; danger?: boolean; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.summary}><Text style={danger ? styles.dangerValue : styles.value}>{value}</Text><Text style={styles.label}>{label}</Text></View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.md },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.base, padding: spacing.lg },
  headerBlock: { borderLeftWidth: 6, borderLeftColor: colors.primary, paddingLeft: spacing.sm, gap: spacing.xs },
  headerKicker: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.caption, fontWeight: fontWeight.semibold, letterSpacing: 1.1 },
  screenTitle: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase" },
  notice: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.bgPanel, padding: spacing.sm },
  summaryRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  summary: { minWidth: "47%", flexGrow: 1, backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.md, shadowColor: colors.borderStrong, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  value: { color: colors.success, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold },
  dangerValue: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold },
  label: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption, letterSpacing: 0.4 },
  riskCard: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.warning, padding: spacing.md, gap: spacing.sm, minHeight: minTouchTarget, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  emptyCard: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.success, padding: spacing.lg, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  safe: { color: colors.success, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.medium },
  title: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  tags: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  tag: { color: colors.warning, borderWidth: 2, borderColor: colors.warning, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, fontFamily: "monospace", fontSize: fontSize.caption },
  link: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  muted: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.body },
  button: { minHeight: minTouchTarget, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.bgPanel, paddingHorizontal: spacing.base, justifyContent: "center", shadowColor: colors.borderStrong, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  buttonText: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold },
  });
}
