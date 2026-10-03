import { useState, useCallback, useEffect, useMemo } from "react";
import {
  AppState,
  View,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { spacing, radius, fontSize, fontWeight, minTouchTarget, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme";
import { useVaultState } from "../state/app-state";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";
import { Text, TextInput } from "../components/Typography";
import { localeForLanguage, useI18n } from "../i18n";
import {
  groupVaultItemsByFolder,
  type VaultFolderSection,
} from "./vault-folder-sections";

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

function searchableText(item: VaultItem): string {
  const common = [
    item.title,
    item.folder,
    item.notes,
    ...item.customFields.flatMap((field) => [
      field.name,
      ...(field.fieldType === "hidden" ? [] : [field.value]),
    ]),
  ];
  const specific = item.type === "login"
    ? [
        item.origin,
        item.username,
        ...(item.androidAssociations ?? []).map((association) => association.packageName),
      ]
    : item.type === "secure_note"
      ? [item.noteBody]
      : [
          item.cardholderName,
          item.cardNumber.replace(/\s/gu, "").slice(-4),
          item.expirationMonth,
          item.expirationYear,
          item.brand,
        ];
  return [...common, ...specific].join("\n").normalize("NFKC").toLocaleLowerCase();
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

export function VaultListScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { language, t } = useI18n();
  const { items, isLocked, isSyncing, lastSyncedAt, conflictCount, pendingMutationCount, error, sync, lock } = useVaultState();
  const [search, setSearch] = useState("");
  const [syncFeedback, setSyncFeedback] = useState<"success" | "error" | null>(null);

  useEffect(() => {
    if (isLocked) setSearch("");
  }, [isLocked]);

  useEffect(() => {
    if (!syncFeedback) return;
    const timer = setTimeout(() => setSyncFeedback(null), 5_000);
    return () => clearTimeout(timer);
  }, [syncFeedback]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") setSearch("");
    });
    return () => subscription.remove();
  }, []);

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const query = search.trim().normalize("NFKC").toLocaleLowerCase();
    return items.filter((item) => searchableText(item).includes(query));
  }, [items, search]);

  const sections = useMemo(
    () => groupVaultItemsByFolder(filteredItems, localeForLanguage(language)),
    [filteredItems, language],
  );

  const handleItemPress = useCallback(
    (itemId: string) => {
      router.push(`/credential/${itemId}`);
    },
    [router]
  );

  const handleSync = useCallback(async () => {
    setSyncFeedback(null);
    const succeeded = await sync();
    setSyncFeedback(succeeded ? "success" : "error");
  }, [sync]);

  const renderItem = useCallback(
    ({ item }: { item: VaultItem }) => (
      <TouchableOpacity
        testID={`vault-item-${item.id}`}
        accessibilityRole="button"
        accessibilityLabel={t("打开条目 {title}", { title: item.title || t("未命名") })}
        style={styles.itemRow}
        onPress={() => handleItemPress(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.itemGlyph}>
          <SymbolView
            name={itemSymbol(item)}
            size={21}
            tintColor={colors.primary}
          />
        </View>
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title || t("未命名")}
          </Text>
          <Text style={styles.itemSubtitle} numberOfLines={1}>
            {isLogin(item)
              ? item.username || item.origin || t("登录")
              : item.type === "secure_note"
                ? item.folder || t("安全笔记")
                : item.brand || t("信用卡")}
          </Text>
        </View>
        <View style={styles.itemRail} />
        <SymbolView
          name={{ ios: "chevron.right", android: "chevron_right", web: "chevron_right" }}
          size={18}
          tintColor={colors.textMuted}
        />
      </TouchableOpacity>
    ),
    [colors.textMuted, handleItemPress, styles, t]
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: VaultFolderSection<VaultItem> }) => {
      const folderName = section.isUncategorized ? t("未分类") : section.folder;
      return (
        <View
          accessible
          accessibilityRole="header"
          accessibilityLabel={t("文件夹 {name}，{count} 项", {
            name: folderName,
            count: section.data.length,
          })}
          style={styles.sectionHeader}
        >
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.sectionIcon}
          >
            <SymbolView
              name={{ ios: "folder.fill", android: "folder", web: "folder" }}
              size={17}
              tintColor={colors.primary}
            />
          </View>
          <Text style={styles.sectionTitle} numberOfLines={1}>
            {folderName}
          </Text>
          <Text style={styles.sectionCount}>
            {String(section.data.length).padStart(2, "0")}
          </Text>
          <View style={styles.sectionRule} />
        </View>
      );
    },
    [colors.primary, styles, t],
  );

  if (isLocked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.lockedText}>{t("密码库已锁定")}</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/unlock")}
          >
            <Text style={styles.buttonText}>{t("去解锁")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={styles.headingGroup}>
          <View style={styles.brandRow}>
            <View style={styles.pixelMark}>
              <View style={styles.pixelMarkInner} />
            </View>
            <Text style={styles.brandLabel}>ZERO VAULT</Text>
            <View style={styles.liveDot} />
          </View>
          <View style={styles.titleRow}>
            <Text style={styles.headerTitle}>{t("凭据")}</Text>
            <Text style={styles.countBadge}>{String(items.length).padStart(2, "0")}</Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            testID="vault-sync"
            style={styles.syncButton}
            onPress={() => { void handleSync(); }}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <>
                <SymbolView
                  name={{ ios: "arrow.triangle.2.circlepath", android: "sync", web: "sync" }}
                  size={17}
                  tintColor={colors.primary}
                />
                <Text style={styles.syncButtonText}>{t("同步")}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.lockButton} onPress={lock}>
            <SymbolView
              name={{ ios: "lock.fill", android: "lock", web: "lock" }}
              size={16}
              tintColor={colors.danger}
            />
            <Text style={styles.lockButtonText}>{t("锁定")}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.syncPanel}>
        <View style={styles.syncPanelLine}>
          <View style={[styles.statusPixel, isSyncing && styles.statusPixelBusy]} />
          <Text style={styles.syncStatus} numberOfLines={1}>
            {lastSyncedAt
              ? t("上次同步于 {time}", {
                  time: new Date(lastSyncedAt).toLocaleString(localeForLanguage(language)),
                })
              : t("同步")}
          </Text>
        </View>
        <View style={styles.queueRow}>
          <Text style={styles.queueText}>{t("待同步 {count} 项", { count: pendingMutationCount })}</Text>
          {conflictCount > 0 ? (
            <TouchableOpacity
              testID="vault-conflicts"
              onPress={() => router.push("/conflicts")}
            >
              <Text style={styles.conflictLink}>{t("处理 {count} 个冲突", { count: conflictCount })}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {syncFeedback ? (
        <View
          testID="vault-sync-feedback"
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[
            styles.syncFeedback,
            syncFeedback === "success" ? styles.syncFeedbackSuccess : styles.syncFeedbackError,
          ]}
        >
          <Text style={styles.syncFeedbackTitle}>
            {syncFeedback === "success" ? t("同步成功") : t("同步失败")}
          </Text>
          <Text style={styles.syncFeedbackBody}>
            {syncFeedback === "success"
              ? t("密码库已与服务器同步。")
              : t("同步未完成，请检查网络后重试。")}
          </Text>
        </View>
      ) : null}

      {error ? <Text testID="vault-error" accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}

      <View style={styles.searchContainer}>
        <SymbolView
          name={{ ios: "magnifyingglass", android: "search", web: "search" }}
          size={20}
          tintColor={colors.textMuted}
        />
        <TextInput
          testID="vault-search"
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t("搜索凭据...")}
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {filteredItems.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIconFrame}>
            <SymbolView
              name={{ ios: "lock.square.stack.fill", android: "inventory_2", web: "inventory_2" }}
              size={40}
              tintColor={colors.primary}
            />
          </View>
          <Text style={styles.emptyText}>
            {items.length === 0 ? t("暂无凭据") : t("未找到匹配的凭据")}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={styles.listContent}
          stickySectionHeadersEnabled={false}
        />
      )}
      <TouchableOpacity testID="vault-add-item" accessibilityRole="button" accessibilityLabel={t("新建密码库条目")} style={styles.floatingButton} onPress={() => router.push("/item/new") }>
        <SymbolView
          name={{ ios: "plus", android: "add", web: "add" }}
          size={30}
          tintColor={colors.primaryContrast}
        />
      </TouchableOpacity>
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
    gap: spacing.base,
  },
  lockedText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    paddingHorizontal: spacing.base,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 2,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.bgShell,
  },
  headingGroup: {
    gap: spacing.xs,
    flexShrink: 1,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  pixelMark: {
    width: 12,
    height: 12,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  pixelMarkInner: {
    width: 4,
    height: 4,
    backgroundColor: colors.primary,
  },
  brandLabel: {
    fontSize: 10,
    letterSpacing: 1.8,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  liveDot: {
    width: 5,
    height: 5,
    backgroundColor: colors.success,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  countBadge: {
    minWidth: 30,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: colors.primary,
    color: colors.primary,
    textAlign: "center",
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    overflow: "hidden",
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  syncButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.primary,
    minHeight: minTouchTarget,
    justifyContent: "center",
    backgroundColor: colors.bgPanel,
  },
  syncButtonText: {
    fontSize: fontSize.bodySm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  lockButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.danger,
    minHeight: minTouchTarget,
    justifyContent: "center",
    backgroundColor: colors.bgPanel,
  },
  lockButtonText: {
    fontSize: fontSize.bodySm,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  syncPanel: {
    marginHorizontal: spacing.base,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.sm,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.bgPanelSoft,
    gap: spacing.xs,
  },
  syncPanelLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  statusPixel: {
    width: 8,
    height: 8,
    backgroundColor: colors.success,
  },
  statusPixelBusy: {
    backgroundColor: colors.warning,
  },
  syncStatus: {
    flex: 1,
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  queueRow: { flexDirection: "row", justifyContent: "space-between" },
  queueText: { color: colors.textMuted, fontSize: fontSize.caption },
  conflictLink: { color: colors.warning, fontSize: fontSize.caption, fontWeight: fontWeight.medium },
  syncFeedback: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 2,
    backgroundColor: colors.bgPanel,
  },
  syncFeedbackSuccess: { borderColor: colors.success },
  syncFeedbackError: { borderColor: colors.danger },
  syncFeedbackTitle: { color: colors.textPrimary, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },
  syncFeedbackBody: { color: colors.textMuted, fontSize: fontSize.caption, marginTop: spacing.xs },
  error: { color: colors.danger, fontSize: fontSize.bodySm, paddingHorizontal: spacing.base, marginBottom: spacing.xs },
  searchContainer: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    backgroundColor: "transparent",
    paddingVertical: spacing.sm,
    fontSize: fontSize.bodySm,
    color: colors.textPrimary,
    minHeight: minTouchTarget,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.md,
    paddingBottom: 96,
  },
  emptyIconFrame: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bgPanel,
    shadowColor: colors.primary,
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 3,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.base,
    paddingBottom: 104,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: minTouchTarget,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    backgroundColor: colors.bgRoot,
  },
  sectionIcon: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bgPanelSoft,
  },
  sectionTitle: {
    maxWidth: "58%",
    color: colors.textPrimary,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.4,
  },
  sectionCount: {
    minWidth: 30,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: colors.primary,
    color: colors.primary,
    backgroundColor: colors.bgPanel,
    textAlign: "center",
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    overflow: "hidden",
  },
  sectionRule: {
    flex: 1,
    height: 2,
    backgroundColor: colors.border,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.md,
    minHeight: 72,
    shadowColor: colors.borderStrong,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 2,
  },
  itemGlyph: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: colors.bgPanelSoft,
    marginRight: spacing.md,
  },
  itemInfo: {
    flex: 1,
    gap: spacing.xs,
  },
  itemTitle: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.medium,
    color: colors.textPrimary,
  },
  itemSubtitle: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  itemRail: {
    width: 3,
    height: 28,
    backgroundColor: colors.primary,
    marginHorizontal: spacing.md,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  buttonText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.primaryContrast,
  },
  floatingButton: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    width: 58,
    height: 58,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.textPrimary,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.textPrimary,
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 5,
  },
});
