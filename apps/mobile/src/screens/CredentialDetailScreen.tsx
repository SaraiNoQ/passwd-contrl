import { useState, useCallback, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { colors, spacing, radius, fontSize, fontWeight, minTouchTarget } from "../theme/tokens";
import { useVaultState } from "../state/vault-state";
import type { VaultItem, VaultLogin } from "@zero-vault/shared";

function isLogin(item: VaultItem): item is VaultLogin {
  return item.type === "login";
}

interface CredentialDetailScreenProps {
  itemId: string;
}

export function CredentialDetailScreen({ itemId }: CredentialDetailScreenProps) {
  const router = useRouter();
  const { items, isLocked } = useVaultState();
  const [showPassword, setShowPassword] = useState(false);

  const item = useMemo(() => items.find((i) => i.id === itemId), [items, itemId]);

  const copyToClipboard = useCallback(async (value: string, label: string) => {
    await Clipboard.setStringAsync(value);
    Alert.alert("已复制", `已复制${label}，建议尽快粘贴并清除剪贴板`);
  }, []);

  if (isLocked || !item) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerContent}>
          <Text style={styles.emptyText}>
            {isLocked ? "密码库已锁定" : "凭据未找到"}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>{item.title || "未命名"}</Text>
          <Text style={styles.typeBadge}>{item.type === "login" ? "登录" : item.type === "secure_note" ? "安全笔记" : "信用卡"}</Text>
        </View>

        {isLogin(item) ? (
          <View style={styles.fields}>
            {item.origin ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>网站</Text>
                <Text style={styles.fieldValue}>{item.origin}</Text>
              </View>
            ) : null}

            {item.username ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>用户名</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue} numberOfLines={1}>
                    {item.username}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => copyToClipboard(item.username, "用户名")}
                  >
                    <Text style={styles.copyButtonText}>复制</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {item.password ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>密码</Text>
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldValue} numberOfLines={1}>
                    {showPassword ? item.password : "••••••••"}
                  </Text>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => setShowPassword(!showPassword)}
                  >
                    <Text style={styles.copyButtonText}>
                      {showPassword ? "隐藏" : "显示"}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.copyButton}
                    onPress={() => copyToClipboard(item.password, "密码")}
                  >
                    <Text style={styles.copyButtonText}>复制</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {item.notes ? (
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>备注</Text>
            <Text style={styles.fieldValue}>{item.notes}</Text>
          </View>
        ) : null}

        <View style={styles.meta}>
          <Text style={styles.metaText}>
            创建: {new Date(item.createdAt).toLocaleString("zh-CN")}
          </Text>
          <Text style={styles.metaText}>
            更新: {new Date(item.updatedAt).toLocaleString("zh-CN")}
          </Text>
        </View>
      </ScrollView>
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
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textMuted,
  },
  content: {
    padding: spacing.base,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    flex: 1,
  },
  typeBadge: {
    fontSize: fontSize.caption,
    color: colors.primary,
    backgroundColor: colors.bgPanel,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  fields: {
    gap: spacing.md,
  },
  field: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
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
    borderWidth: 1,
    borderColor: colors.border,
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
  },
  metaText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
});
