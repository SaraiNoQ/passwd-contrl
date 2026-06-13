import { useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { colors, spacing, radius, fontSize, fontWeight, minTouchTarget } from "../theme/tokens";
import { useVaultState } from "../state/vault-state";

export function UnlockScreen() {
  const router = useRouter();
  const { unlock, isLocked, isLoading, error, clearError } = useVaultState();
  const [masterPassword, setMasterPassword] = useState("");

  const handleUnlock = useCallback(async () => {
    clearError();
    const success = await unlock(masterPassword);
    if (success) {
      router.replace("/(tabs)/vault");
    }
  }, [masterPassword, unlock, clearError, router]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.inner}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.header}>
          <Text style={styles.title}>解锁密码库</Text>
          <Text style={styles.subtitle}>
            输入主密码以解锁本地密码库
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>主密码</Text>
          <TextInput
            style={styles.input}
            value={masterPassword}
            onChangeText={setMasterPassword}
            placeholder="输入主密码"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoComplete="password"
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={[styles.button, isLoading && styles.buttonDisabled]}
            onPress={handleUnlock}
            disabled={isLoading || !masterPassword}
            activeOpacity={0.8}
          >
            {isLoading ? (
              <ActivityIndicator color={colors.bgRoot} />
            ) : (
              <Text style={styles.buttonText}>解锁</Text>
            )}
          </TouchableOpacity>
        </View>

        <Text style={styles.securityNote}>
          主密码只在此设备上使用，不会发送到服务器
        </Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgRoot,
  },
  inner: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  header: {
    alignItems: "center",
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: fontSize.heading,
    fontWeight: fontWeight.semibold,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
  form: {
    gap: spacing.sm,
  },
  label: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  input: {
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: fontSize.body,
    color: colors.textPrimary,
    minHeight: minTouchTarget,
  },
  error: {
    fontSize: fontSize.bodySm,
    color: colors.danger,
    textAlign: "center",
  },
  button: {
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
  buttonText: {
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
    color: colors.bgRoot,
  },
  securityNote: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.xl,
  },
});
