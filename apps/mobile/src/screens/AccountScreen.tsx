import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuthState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

export function AccountScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user, device, error, clearError, logout, deleteAccount } = useAuthState();
  const [confirmation, setConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleLogout = useCallback(() => {
    Alert.alert(t("确认退出"), t("退出会撤销本次移动会话，并清除本机保存的会话令牌。"), [
      { text: t("取消"), style: "cancel" },
      {
        text: t("退出"),
        style: "destructive",
        onPress: () => { void logout().then((done) => done && router.replace("/login")); },
      },
    ]);
  }, [logout, router, t]);

  const handleDelete = useCallback(() => {
    if (!user || confirmation.trim().toLowerCase() !== user.email.toLowerCase() || isDeleting) return;
    Alert.alert(
      t("永久删除账户？"),
      t("服务器密码库、设备信任、会话和恢复材料将被永久删除。本机密文与 Keystore 密钥也会清除，此操作无法撤销。"),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("永久删除"),
          style: "destructive",
          onPress: async () => {
            setIsDeleting(true);
            clearError();
            const deleted = await deleteAccount();
            setIsDeleting(false);
            if (deleted) router.replace("/login");
          },
        },
      ],
    );
  }, [clearError, confirmation, deleteAccount, isDeleting, router, t, user]);

  if (!user) return null;
  const deleteEnabled = confirmation.trim().toLowerCase() === user.email.toLowerCase() && !isDeleting;

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("账户信息")}</Text>
          <Text style={styles.label}>{t("邮箱")}</Text>
          <Text selectable style={styles.value}>{user.email}</Text>
          <Text style={styles.help}>
            {t("邮箱是 OPAQUE 账户标识，当前协议不允许原地修改。需要更换邮箱时，请先在 Web 端生成可移植的 crypto-core 加密备份，在新账户导入并核对后再删除旧账户。")}
          </Text>
          <Text style={styles.label}>{t("服务器修订号")}</Text>
          <Text style={styles.value}>{user.serverRevision}</Text>
          <Text style={styles.label}>{t("当前设备")}</Text>
          <Text style={styles.value}>{device?.status === "approved" ? t("已信任") : t("等待批准")}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{t("安全与恢复")}</Text>
          <NavButton styles={styles} label={t("管理可信设备")} onPress={() => router.push("/devices")} />
          <NavButton styles={styles} label={t("轮换恢复码")} onPress={() => router.push("/recovery")} />
          <NavButton styles={styles} label={t("使用恢复码重置主密码")} onPress={() => router.push("/recovery")} />
          <Text style={styles.help}>{t("主密码重置只通过恢复 v2 完成；成功后旧会话、旧设备和旧恢复码都会失效。")}</Text>
        </View>

        <TouchableOpacity accessibilityRole="button" style={styles.outlineButton} onPress={handleLogout}>
          <Text style={styles.outlineText}>{t("退出当前会话")}</Text>
        </TouchableOpacity>

        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.dangerTitle}>{t("永久删除账户")}</Text>
          <Text style={styles.help}>{t("输入完整账户邮箱后才能继续。删除失败时不会清除本机密码库。")}</Text>
          <TextInput
            testID="account-delete-confirmation"
            accessibilityLabel={t("输入账户邮箱确认删除")}
            style={styles.input}
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder={user.email}
            placeholderTextColor={colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="off"
            importantForAutofill="no"
          />
          {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}
          <TouchableOpacity
            testID="account-delete"
            accessibilityRole="button"
            accessibilityState={{ disabled: !deleteEnabled }}
            style={[styles.deleteButton, !deleteEnabled && styles.disabled]}
            disabled={!deleteEnabled}
            onPress={handleDelete}
          >
            {isDeleting
              ? <ActivityIndicator color={colors.dangerContrast} />
              : <Text style={styles.deleteText}>{t("永久删除账户")}</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function NavButton({ label, onPress, styles }: { label: string; onPress: () => void; styles: ReturnType<typeof createStyles> }) {
  return (
    <TouchableOpacity accessibilityRole="button" style={styles.navButton} onPress={onPress}>
      <Text style={styles.navText}>{label}　›</Text>
    </TouchableOpacity>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.lg },
  card: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.base, gap: spacing.sm, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  dangerCard: { borderColor: colors.danger, shadowColor: colors.danger },
  sectionTitle: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.subheading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase", borderBottomWidth: 2, borderBottomColor: colors.primary, paddingBottom: spacing.sm },
  dangerTitle: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.subheading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase", borderBottomWidth: 2, borderBottomColor: colors.danger, paddingBottom: spacing.sm },
  label: { color: colors.textMuted, fontFamily: "monospace", fontSize: fontSize.caption, letterSpacing: 0.5, marginTop: spacing.xs },
  value: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.medium },
  help: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21 },
  navButton: { minHeight: minTouchTarget, justifyContent: "center", borderTopWidth: 2, borderTopColor: colors.border, paddingHorizontal: spacing.xs },
  navText: { color: colors.primary, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.medium },
  outlineButton: { minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.danger, backgroundColor: colors.bgPanel, shadowColor: colors.danger, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  outlineText: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },
  input: { minHeight: minTouchTarget, borderWidth: 2, borderColor: colors.borderStrong, color: colors.textPrimary, backgroundColor: colors.bgRoot, paddingHorizontal: spacing.md, fontFamily: "monospace", fontSize: fontSize.body },
  error: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm },
  deleteButton: { minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", backgroundColor: colors.danger, borderWidth: 2, borderColor: colors.danger, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  deleteText: { color: colors.dangerContrast, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.8 },
  disabled: { opacity: 0.45 },
  });
}
