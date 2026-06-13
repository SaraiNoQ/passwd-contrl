import { useCallback } from "react";
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
import Constants from "expo-constants";
import { colors, spacing, radius, fontSize, fontWeight, minTouchTarget } from "../theme/tokens";
import { useVaultState } from "../state/vault-state";
import { useAuthState } from "../state/auth-state";

export function SettingsScreen() {
  const router = useRouter();
  const { lock, autoLockMinutes, setAutoLockMinutes } = useVaultState();
  const { logout, user } = useAuthState();

  const handleLock = useCallback(() => {
    lock();
    router.replace("/unlock");
  }, [lock, router]);

  const handleLogout = useCallback(() => {
    Alert.alert("确认退出", "退出后需要重新登录", [
      { text: "取消", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: async () => {
          await logout();
          router.replace("/login");
        },
      },
    ]);
  }, [logout, router]);

  const handleAutoLockChange = useCallback(() => {
    const options = [1, 5, 15, 30, 60];
    Alert.alert(
      "自动锁定时间",
      "选择自动锁定时间（分钟）",
      options.map((m) => ({
        text: `${m} 分钟`,
        onPress: () => setAutoLockMinutes(m),
      }))
    );
  }, [setAutoLockMinutes]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>设置</Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>账户</Text>
          {user ? (
            <View style={styles.card}>
              <Text style={styles.cardLabel}>邮箱</Text>
              <Text style={styles.cardValue}>{user.email}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>安全</Text>
          <TouchableOpacity style={styles.card} onPress={handleAutoLockChange}>
            <Text style={styles.cardLabel}>自动锁定</Text>
            <Text style={styles.cardValue}>{autoLockMinutes} 分钟</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.card} onPress={handleLock}>
            <Text style={styles.dangerText}>立即锁定</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>关于</Text>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>版本</Text>
            <Text style={styles.cardValue}>
              {Constants.expoConfig?.version ?? "0.1.0"}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>API 环境</Text>
            <Text style={styles.cardValue}>生产</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutText}>退出登录</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  content: {
    padding: spacing.base,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  card: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    minHeight: minTouchTarget,
    justifyContent: "center",
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
  dangerText: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: fontWeight.medium,
    textAlign: "center",
  },
  logoutButton: {
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    minHeight: minTouchTarget,
    justifyContent: "center",
    marginTop: spacing.md,
  },
  logoutText: {
    fontSize: fontSize.body,
    color: colors.danger,
    fontWeight: fontWeight.medium,
  },
});
