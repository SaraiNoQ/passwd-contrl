import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius, fontSize, fontWeight, minTouchTarget } from "../theme/tokens";
import { useVaultState } from "../state/vault-state";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

export function VaultListScreen() {
  const router = useRouter();
  const { items, isLocked, isSyncing, lastSyncedAt, sync, lock } = useVaultState();
  const [search, setSearch] = useState("");

  const filteredItems = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((item) => {
      if (item.title.toLowerCase().includes(q)) return true;
      if (isLogin(item)) {
        if (item.origin.toLowerCase().includes(q)) return true;
        if (item.username.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [items, search]);

  const handleItemPress = useCallback(
    (itemId: string) => {
      router.push(`/credential/${itemId}`);
    },
    [router]
  );

  const handleSync = useCallback(() => {
    sync();
  }, [sync]);

  const renderItem = useCallback(
    ({ item }: { item: VaultItem }) => (
      <TouchableOpacity
        style={styles.itemRow}
        onPress={() => handleItemPress(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title || "未命名"}
          </Text>
          {isLogin(item) ? (
            <Text style={styles.itemSubtitle} numberOfLines={1}>
              {item.username || item.origin || ""}
            </Text>
          ) : null}
        </View>
        <Text style={styles.itemArrow}>›</Text>
      </TouchableOpacity>
    ),
    [handleItemPress]
  );

  if (isLocked) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.lockedText}>密码库已锁定</Text>
          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace("/unlock")}
          >
            <Text style={styles.buttonText}>去解锁</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>凭据</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : (
              <Text style={styles.syncButtonText}>同步</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.lockButton} onPress={lock}>
            <Text style={styles.lockButtonText}>锁定</Text>
          </TouchableOpacity>
        </View>
      </View>

      {lastSyncedAt ? (
        <Text style={styles.syncStatus}>
          上次同步: {new Date(lastSyncedAt).toLocaleString("zh-CN")}
        </Text>
      ) : null}

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="搜索凭据..."
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {filteredItems.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>
            {items.length === 0 ? "暂无凭据" : "未找到匹配的凭据"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredItems}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    alignItems: "center",
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
  },
  headerTitle: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
  },
  headerActions: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  syncButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  syncButtonText: {
    fontSize: fontSize.bodySm,
    color: colors.primary,
    fontWeight: fontWeight.medium,
  },
  lockButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    minHeight: minTouchTarget,
    justifyContent: "center",
  },
  lockButtonText: {
    fontSize: fontSize.bodySm,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
  syncStatus: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.xs,
  },
  searchContainer: {
    paddingHorizontal: spacing.base,
    marginBottom: spacing.md,
  },
  searchInput: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: fontSize.bodySm,
    color: colors.textPrimary,
    minHeight: minTouchTarget,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  listContent: {
    paddingHorizontal: spacing.base,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    minHeight: minTouchTarget,
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
  itemArrow: {
    fontSize: fontSize.subheading,
    color: colors.textMuted,
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
    color: colors.bgRoot,
  },
});
