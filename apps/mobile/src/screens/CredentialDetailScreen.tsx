import { useState, useCallback, useMemo, useEffect } from "react";
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  AppState,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { copySensitiveToClipboard } from "@zero-vault/zero-vault-native";
import { spacing, radius, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { useVaultState } from "../state/app-state";
import type { VaultHistoryVersion } from "../state/vault-state";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";
import { Text } from "../components/Typography";
import { useI18n } from "../i18n";

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

function maskedCardNumber(value: string): string {
  const compact = value.replace(/\s/gu, "");
  return compact.length > 4 ? `•••• •••• •••• ${compact.slice(-4)}` : "••••";
}

function maskedValue(value: string): string {
  return "•".repeat(Math.max(4, Math.min(value.length, 12)));
}

function itemSymbol(item: VaultItem) {
  if (item.type === "secure_note") {
    return { ios: "doc.text.fill", android: "description", web: "description" } as const;
  }
  if (item.type === "credit_card") {
    return { ios: "creditcard.fill", android: "credit_card", web: "credit_card" } as const;
  }
  return { ios: "key.fill", android: "key", web: "key" } as const;
}

interface CredentialDetailScreenProps {
  itemId: string;
}

export function CredentialDetailScreen({ itemId }: CredentialDetailScreenProps) {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language, t } = useI18n();
  const dateLocale = language === "zh" ? "zh-CN" : "en-US";
  const { items, isLocked, deleteItem, saveItem, generateTotp, loadItemHistory } = useVaultState();
  const [showPassword, setShowPassword] = useState(false);
  const [showCardNumber, setShowCardNumber] = useState(false);
  const [showCvv, setShowCvv] = useState(false);
  const [visibleHiddenFields, setVisibleHiddenFields] = useState<Set<number>>(() => new Set());
  const [totp, setTotp] = useState<{ code: string; validForSeconds: number } | null>(null);
  const [history, setHistory] = useState<VaultHistoryVersion[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const item = useMemo(() => items.find((candidate) => candidate.id === itemId), [items, itemId]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setShowPassword(false);
        setShowCardNumber(false);
        setShowCvv(false);
        setVisibleHiddenFields(new Set());
        setTotp(null);
        setHistory(null);
        setHistoryError(null);
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (isLocked) {
      setShowPassword(false);
      setShowCardNumber(false);
      setShowCvv(false);
      setVisibleHiddenFields(new Set());
      setHistory(null);
      setHistoryError(null);
    }
  }, [isLocked]);

  useEffect(() => {
    setShowPassword(false);
    setShowCardNumber(false);
    setShowCvv(false);
    setVisibleHiddenFields(new Set());
    setHistory(null);
    setHistoryError(null);
  }, [item]);

  useEffect(() => {
    if (!item || item.type !== "login" || !item.totp || isLocked) {
      setTotp(null);
      return;
    }
    let active = true;
    const update = async () => {
      try {
        const value = await generateTotp(item.totp!);
        if (active && AppState.currentState === "active") setTotp(value);
      } catch {
        if (active) setTotp(null);
      }
    };
    void update();
    const timer = setInterval(update, 1_000);
    return () => { active = false; clearInterval(timer); };
  }, [generateTotp, isLocked, item]);

  const confirmDelete = useCallback(() => {
    Alert.alert(t("删除条目"), t("删除会进入离线同步队列，并在同步后影响其他设备。"), [
      { text: t("取消"), style: "cancel" },
      {
        text: t("删除"),
        style: "destructive",
        onPress: async () => {
          if (await deleteItem(itemId)) {
            router.replace("/(tabs)/vault");
          } else {
            Alert.alert(t("删除失败"), t("条目仍保留在本机，未写入删除队列。请重试。"));
          }
        },
      },
    ]);
  }, [deleteItem, itemId, router, t]);

  const copyToClipboard = useCallback(async (value: string, label: string) => {
    await copySensitiveToClipboard(value, 30_000);
    Alert.alert(t("已复制"), t("已复制{label}，未被替换时将在 30 秒后清除", { label }));
  }, [t]);

  const toggleHiddenField = useCallback((index: number) => {
    setVisibleHiddenFields((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const handleLoadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      setHistory(await loadItemHistory(itemId));
    } catch (cause) {
      setHistory(null);
      setHistoryError(cause instanceof Error && cause.message === "network_error"
        ? "网络连接失败，无法读取云端历史版本"
        : "历史版本读取失败，请确认密码库仍处于解锁状态");
    } finally {
      setHistoryLoading(false);
    }
  }, [itemId, loadItemHistory]);

  const confirmRestoreHistory = useCallback((version: VaultHistoryVersion) => {
    Alert.alert(
      t("恢复历史版本"),
      t("版本 {revision} 会作为一次新的修改进入同步队列，当前版本仍保留在云端历史中。", { revision: version.revision }),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("恢复"),
          onPress: () => {
            const restored = { ...version.item, updatedAt: new Date().toISOString() } as VaultItem;
            void saveItem(restored).then((saved) => {
              if (saved) {
                setHistory(null);
                Alert.alert(t("已恢复"), t("历史版本已写入本机并进入同步队列"), [{ text: t("确定") }]);
              } else {
                Alert.alert(t("恢复失败"), t("历史版本未写入本机，当前条目保持不变。"));
              }
            });
          },
        },
      ],
    );
  }, [saveItem, t]);

  if (isLocked || !item) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centerContent}>
          <Text style={styles.emptyText}>
            {isLocked ? t("密码库已锁定") : t("凭据未找到")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View style={styles.headerIcon}>
            <SymbolView name={itemSymbol(item)} size={28} tintColor={colors.primary} />
          </View>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{item.title || t("未命名")}</Text>
            <View style={styles.headerSignal}>
              <View style={styles.signalPixel} />
              <View style={styles.signalPixel} />
              <View style={[styles.signalPixel, styles.signalPixelMuted]} />
            </View>
          </View>
          <Text style={styles.typeBadge}>{item.type === "login" ? t("登录") : item.type === "secure_note" ? t("安全笔记") : t("信用卡")}</Text>
        </View>

        <View style={styles.actions}>
          <TouchableOpacity testID="credential-edit" style={styles.actionButton} onPress={() => router.push(`/item/${item.id}/edit`)}>
            <SymbolView name={{ ios: "pencil", android: "edit", web: "edit" }} size={17} tintColor={colors.primary} />
            <Text style={styles.actionText}>{t("编辑")}</Text>
          </TouchableOpacity>
          <TouchableOpacity testID="credential-delete" style={[styles.actionButton, styles.deleteButton]} onPress={confirmDelete}>
            <SymbolView name={{ ios: "trash", android: "delete", web: "delete" }} size={17} tintColor={colors.danger} />
            <Text style={styles.deleteText}>{t("删除")}</Text>
          </TouchableOpacity>
        </View>

        {isLogin(item) ? (
          <View style={styles.fields}>
            {item.origin ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("网站")}</Text>
                <Text style={styles.fieldValue}>{item.origin}</Text>
              </View>
            ) : null}

            {item.username ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("用户名")}</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue} numberOfLines={1}>
                    {item.username}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => copyToClipboard(item.username, t("用户名"))}
                  >
                    <Text style={styles.copyButtonText}>{t("复制")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {item.password ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("密码")}</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue} numberOfLines={1}>
                    {showPassword ? item.password : "••••••••"}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text style={styles.copyButtonText}>
                      {showPassword ? t("隐藏") : t("显示")}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => copyToClipboard(item.password, t("密码"))}
                  >
                    <Text style={styles.copyButtonText}>{t("复制")}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {totp ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("动态验证码（{seconds}s）", { seconds: totp.validForSeconds })}</Text>
                <View style={styles.fieldRow}><Text testID="credential-totp-code" style={styles.totpCode}>{totp.code}</Text><TouchableOpacity style={styles.copyButton} onPress={() => copyToClipboard(totp.code, t("动态验证码"))}><Text style={styles.copyButtonText}>{t("复制")}</Text></TouchableOpacity></View>
              </View>
            ) : null}

            {(item.androidAssociations ?? []).length > 0 ? (
              <View style={styles.associations}>
                <Text style={styles.sectionLabel}>{t("Android App 关联")}</Text>
                {item.androidAssociations?.map((association) => (
                  <View key={`${association.packageName}:${association.signingCertificateSha256}`} style={styles.field}>
                    <Text style={styles.fieldValue}>{association.packageName}</Text>
                    <Text style={styles.fingerprint}>SHA-256 {association.signingCertificateSha256}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        {item.type === "secure_note" ? <View style={styles.field}><Text style={styles.fieldLabel}>{t("安全笔记")}</Text><Text testID="credential-note-body" style={styles.fieldValue}>{item.noteBody}</Text></View> : null}

        {item.type === "credit_card" ? (
          <View style={styles.fields}>
            <View style={styles.field}><Text style={styles.fieldLabel}>{t("持卡人")}</Text><Text style={styles.fieldValue}>{item.cardholderName}</Text></View>
            {item.brand ? <View style={styles.field}><Text style={styles.fieldLabel}>{t("卡组织")}</Text><Text style={styles.fieldValue}>{item.brand}</Text></View> : null}
            {item.cardNumber ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>{t("卡号")}</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue}>{showCardNumber ? item.cardNumber : maskedCardNumber(item.cardNumber)}</Text>
                  <TouchableOpacity testID="credential-card-reveal" style={styles.copyButton} onPress={() => setShowCardNumber((current) => !current)}><Text style={styles.copyButtonText}>{showCardNumber ? t("隐藏") : t("显示")}</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.copyButton} onPress={() => copyToClipboard(item.cardNumber, t("卡号"))}><Text style={styles.copyButtonText}>{t("复制")}</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}
            <View style={styles.field}><Text style={styles.fieldLabel}>{t("有效期")}</Text><Text style={styles.fieldValue}>{item.expirationMonth}/{item.expirationYear}</Text></View>
            {item.cvv ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>CVV</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue}>{showCvv ? item.cvv : maskedValue(item.cvv)}</Text>
                  <TouchableOpacity testID="credential-cvv-reveal" style={styles.copyButton} onPress={() => setShowCvv((current) => !current)}><Text style={styles.copyButtonText}>{showCvv ? t("隐藏") : t("显示")}</Text></TouchableOpacity>
                  <TouchableOpacity style={styles.copyButton} onPress={() => copyToClipboard(item.cvv, "CVV")}><Text style={styles.copyButtonText}>{t("复制")}</Text></TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {item.customFields.length > 0 ? (
          <View style={styles.customFields}>
            <Text style={styles.sectionLabel}>{t("自定义字段")}</Text>
            {item.customFields.map((field, index) => {
              const hidden = field.fieldType === "hidden";
              const revealed = visibleHiddenFields.has(index);
              return (
                <View key={`${field.name}:${index}`} style={styles.field}>
                  <Text style={styles.fieldLabel}>{field.name}</Text>
                  <View style={styles.fieldRow}>
                    <Text style={styles.fieldValue}>{hidden && !revealed ? maskedValue(field.value) : field.value}</Text>
                    {hidden ? (
                      <TouchableOpacity testID={`credential-custom-reveal-${index}`} style={styles.copyButton} onPress={() => toggleHiddenField(index)}>
                        <Text style={styles.copyButtonText}>{revealed ? t("隐藏") : t("显示")}</Text>
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity style={styles.copyButton} onPress={() => copyToClipboard(field.value, field.name)}><Text style={styles.copyButtonText}>{t("复制")}</Text></TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}

        {item.notes ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>{t("备注")}</Text>
            <Text style={styles.fieldValue}>{item.notes}</Text>
          </View>
        ) : null}

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            {t("创建于 {time}", { time: new Date(item.createdAt).toLocaleString(dateLocale) })}
          </Text>
          <Text style={styles.metaText}>
            {t("更新于 {time}", { time: new Date(item.updatedAt).toLocaleString(dateLocale) })}
          </Text>
        </View>

        <View style={styles.historySection}>
          <TouchableOpacity
            testID="credential-history"
            accessibilityRole="button"
            accessibilityLabel={t("读取历史版本")}
            disabled={historyLoading}
            style={styles.historyButton}
            onPress={() => { void handleLoadHistory(); }}
          >
            <Text style={styles.actionText}>{historyLoading ? t("正在读取…") : t("历史版本")}</Text>
          </TouchableOpacity>
          {historyError ? <Text style={styles.historyError}>{t(historyError)}</Text> : null}
          {history?.length === 0 ? <Text style={styles.metaText}>{t("暂无历史版本")}</Text> : null}
          {history?.map((version) => (
            <View key={`${version.revision}:${version.createdAt}`} style={styles.historyCard}>
              <Text style={styles.cardTitle}>{t("版本 {revision} · {time}", { revision: version.revision, time: new Date(version.createdAt).toLocaleString(dateLocale) })}</Text>
              <Text style={styles.fieldValue}>{version.item.title || t("未命名")}</Text>
              {version.item.type === "login" ? (
                <>
                  <Text style={styles.metaText}>{version.item.origin || t("无网站")}</Text>
                  <Text style={styles.metaText}>{version.item.username || t("无用户名")}</Text>
                  <Text style={styles.metaText}>{t("密码已隐藏")}</Text>
                </>
              ) : null}
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={t("恢复历史版本 {revision}", { revision: version.revision })}
                testID={`history-restore-${version.revision}`}
                style={styles.historyRestoreButton}
                onPress={() => confirmRestoreHistory(version)}
              >
                <Text style={styles.actionText}>{t("恢复此版本")}</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  centerContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.base,
    paddingBottom: 56,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgPanelSoft,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 5, height: 5 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  headerIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bgPanel,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  headerSignal: {
    flexDirection: "row",
    gap: 3,
  },
  signalPixel: {
    width: 12,
    height: 3,
    backgroundColor: colors.primary,
  },
  signalPixelMuted: {
    backgroundColor: colors.borderStrong,
  },
  typeBadge: {
    fontSize: fontSize.caption,
    color: colors.primary,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  fields: {
    gap: spacing.md,
  },
  associations: { gap: spacing.sm },
  customFields: { gap: spacing.sm, marginTop: spacing.md },
  sectionLabel: {
    color: colors.textPrimary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    borderLeftWidth: 6,
    borderLeftColor: colors.primary,
    paddingLeft: spacing.sm,
  },
  fingerprint: { color: colors.textMuted, fontSize: fontSize.caption, fontFamily: "monospace", marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  actionButton: {
    minHeight: 48,
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteButton: { borderColor: colors.danger },
  actionText: { color: colors.primary, fontWeight: fontWeight.medium },
  deleteText: { color: colors.danger, fontWeight: fontWeight.medium },
  totpCode: { color: colors.primary, fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 3, flex: 1 },
  field: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderLeftWidth: 6,
    borderColor: colors.border,
    borderLeftColor: colors.primary,
    borderRadius: radius.sm,
    padding: spacing.md,
  },
  fieldLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  fieldValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    flex: 1,
  },
  copyButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bgPanelSoft,
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  copyButtonText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  meta: {
    marginTop: spacing.lg,
    gap: spacing.xs,
    padding: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bgPanelSoft,
  },
  metaText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  historySection: { marginTop: spacing.lg, gap: spacing.sm },
  historyButton: {
    minHeight: 48,
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
    backgroundColor: colors.bgPanel,
    alignItems: "center",
    justifyContent: "center",
  },
  historyError: { fontSize: fontSize.caption, color: colors.danger },
  historyCard: {
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    padding: spacing.md,
    gap: spacing.xs,
  },
  historyRestoreButton: {
    minHeight: minTouchTarget,
    marginTop: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    borderRadius: radius.sm,
  },
  cardTitle: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: fontWeight.semibold },
});
