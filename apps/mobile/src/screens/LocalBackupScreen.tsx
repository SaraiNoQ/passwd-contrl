import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  AppState,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  discardNativeStagedBackup,
  exportNativeEncryptedBackupDocument,
  importNativeStagedCryptoCoreBackup,
  restoreNativeStagedEncryptedBackup,
  stageNativeBackupDocument,
  type NativeBackupKind,
} from "@zero-vault/zero-vault-native";
import { useAuthState, useVaultState } from "../state/app-state";
import { fontSize, fontWeight, minTouchTarget, spacing, type ThemeColors } from "../theme/tokens";
import { Text, TextInput } from "../components/Typography";
import { useI18n } from "../i18n";
import { useTheme } from "../theme/theme";

type PendingBackupOperation = {
  operationId: string;
  kind: NativeBackupKind;
  accountId: string | null;
  backupId: string | null;
  createdAt: string | null;
};

export function LocalBackupScreen() {
  const router = useRouter();
  const { t } = useI18n();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const auth = useAuthState();
  const vault = useVaultState();
  const [pendingOperation, setPendingOperation] = useState<PendingBackupOperation | null>(null);
  const pendingOperationRef = useRef<PendingBackupOperation | null>(null);
  const [masterPassword, setMasterPassword] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        setMasterPassword("");
        setBackupPassword("");
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    const operation = pendingOperationRef.current;
    pendingOperationRef.current = null;
    if (operation) void discardNativeStagedBackup(operation.operationId).catch(() => undefined);
  }, []);

  const replacePendingOperation = useCallback((operation: PendingBackupOperation | null) => {
    pendingOperationRef.current = operation;
    setPendingOperation(operation);
  }, []);

  const discardPendingOperation = useCallback(async (
    operation: PendingBackupOperation,
  ): Promise<void> => {
    if (pendingOperationRef.current?.operationId === operation.operationId) {
      replacePendingOperation(null);
    }
    await discardNativeStagedBackup(operation.operationId);
  }, [replacePendingOperation]);

  useEffect(() => {
    if (
      vault.isLocked &&
      pendingOperation === null &&
      !busy &&
      AppState.currentState === "active"
    ) {
      router.replace("/unlock");
    }
  }, [busy, pendingOperation, router, vault.isLocked]);

  const exportBackup = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      if (!auth.user?.id) throw new Error("auth_required");
      const result = await exportNativeEncryptedBackupDocument(auth.user.id);
      if (result.saved) Alert.alert(t("导出完成"), t("加密备份已写入你选择的文件。"));
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, [auth.user?.id, t]);

  const restoreBackup = useCallback(async () => {
    setBusy(true);
    setError("");
    replacePendingOperation(null);
    setMasterPassword("");
    setBackupPassword("");
    let stagedOperationId: string | null = null;
    try {
      if (!auth.user?.id) throw new Error("auth_required");
      const staged = await stageNativeBackupDocument("android");
      if (staged.status === "cancelled") return;
      stagedOperationId = staged.operationId;
      if (staged.accountId && staged.accountId !== auth.user.id) {
        await discardNativeStagedBackup(staged.operationId);
        stagedOperationId = null;
        throw new Error("backup_account_mismatch");
      }
      vault.lock();
      replacePendingOperation({
        operationId: staged.operationId,
        kind: staged.kind,
        accountId: staged.accountId ?? null,
        backupId: staged.backupId ?? null,
        createdAt: staged.createdAt ?? null,
      });
      stagedOperationId = null;
    } catch (cause) {
      if (stagedOperationId) {
        await discardNativeStagedBackup(stagedOperationId).catch(() => undefined);
      }
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, [auth.user?.id, replacePendingOperation, vault.lock]);

  const importWebBackup = useCallback(async () => {
    replacePendingOperation(null);
    setMasterPassword("");
    setBackupPassword("");
    setBusy(true);
    setError("");
    let stagedOperationId: string | null = null;
    try {
      if (!auth.user?.id) throw new Error("auth_required");
      const staged = await stageNativeBackupDocument("crypto-core");
      if (staged.status === "cancelled") return;
      stagedOperationId = staged.operationId;
      vault.lock();
      replacePendingOperation({
        operationId: staged.operationId,
        kind: staged.kind,
        accountId: staged.accountId ?? null,
        backupId: staged.backupId ?? null,
        createdAt: staged.createdAt ?? null,
      });
      stagedOperationId = null;
    } catch (cause) {
      if (stagedOperationId) {
        await discardNativeStagedBackup(stagedOperationId).catch(() => undefined);
      }
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, [auth.user?.id, replacePendingOperation, vault.lock]);

  const continuePendingOperation = useCallback(async (mode: "password" | "biometric") => {
    const operation = pendingOperation;
    if (!operation || busy) return;
    if (
      (mode === "password" && vault.localDeviceSecurityState?.unlockState !== "PASSWORD_ALLOWED") ||
      (mode === "biometric" && vault.localDeviceSecurityState?.unlockState !== "BIOMETRIC_READY")
    ) {
      setError("本机安全策略已变化，请返回解锁页重新验证或执行恢复。");
      return;
    }
    if (operation.kind === "crypto-core" && !backupPassword) {
      setError("请输入 Web crypto-core 加密备份的独立密码。");
      return;
    }
    if (mode === "password" && !masterPassword) {
      setError("请输入 Zero Vault 主密码重新授权。");
      return;
    }

    const authorizationPassword = masterPassword;
    const importPassword = backupPassword;
    setMasterPassword("");
    setBackupPassword("");
    setBusy(true);
    setError("");
    auth.clearError();
    vault.clearError();
    try {
      const unlocked = mode === "biometric"
        ? await vault.unlockWithBiometric()
        : await auth.authorizeVaultUnlock(authorizationPassword) && await vault.unlock();
      if (!unlocked) {
        setError(mode === "biometric"
          ? "强生物识别未完成，密码库仍保持锁定。"
          : "主密码授权或设备解锁失败，密码库仍保持锁定。");
        await discardPendingOperation(operation);
        return;
      }
      if (!auth.user?.id) throw new Error("auth_required");

      if (operation.kind === "android") {
        await restoreNativeStagedEncryptedBackup(auth.user.id, operation.operationId);
        replacePendingOperation(null);
        vault.lock();
        router.replace("/unlock");
      } else {
        const { importedCount } = await importNativeStagedCryptoCoreBackup(
          auth.user.id,
          operation.operationId,
          importPassword,
        );
        replacePendingOperation(null);
        vault.lock();
        router.replace("/unlock");
        Alert.alert(
          t("导入完成"),
          t("已安全导入 {count} 个条目；它们已进入离线同步队列。", { count: importedCount }),
        );
      }
    } catch (cause) {
      await discardPendingOperation(operation).catch(() => undefined);
      setError(messageFor(cause));
    } finally {
      setMasterPassword("");
      setBackupPassword("");
      setBusy(false);
    }
  }, [
    auth.authorizeVaultUnlock,
    auth.clearError,
    auth.user?.id,
    backupPassword,
    busy,
    discardPendingOperation,
    masterPassword,
    pendingOperation,
    replacePendingOperation,
    router,
    t,
    vault.clearError,
    vault.localDeviceSecurityState,
    vault.lock,
    vault.unlock,
    vault.unlockWithBiometric,
  ]);

  const confirmPendingOperation = useCallback((mode: "password" | "biometric") => {
    if (pendingOperation?.kind !== "android") {
      void continuePendingOperation(mode);
      return;
    }
    Alert.alert(
      t("确认恢复本地备份？"),
      t("此操作会原子替换本机 Room 密文库、离线队列和同步游标，完成后立即锁定。"),
      [
        { text: t("取消"), style: "cancel" },
        {
          text: t("确认恢复"),
          style: "destructive",
          onPress: () => { void continuePendingOperation(mode); },
        },
      ],
    );
  }, [continuePendingOperation, pendingOperation, t]);

  const cancelPendingOperation = useCallback(async () => {
    const operation = pendingOperationRef.current;
    replacePendingOperation(null);
    setMasterPassword("");
    setBackupPassword("");
    setError("");
    if (!operation) return;
    setBusy(true);
    try {
      await discardNativeStagedBackup(operation.operationId);
    } catch (cause) {
      setError(messageFor(cause));
    } finally {
      setBusy(false);
    }
  }, [replacePendingOperation]);

  const unavailable = busy || vault.isLocked || vault.isSyncing || pendingOperation !== null;
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t("本地加密备份")}</Text>
        <Text style={styles.description}>
          {t("文件只公开格式、账户标识、备份 ID 和创建时间；Room 快照由密码库密钥认证加密。恢复时必须使用同一账户的密钥。")}
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error)}</Text> : null}

        {pendingOperation ? (
          <View style={[styles.card, styles.authorizationCard]}>
            <Text style={styles.cardTitle}>{t("重新授权后继续")}</Text>
            <Text style={styles.help}>
              {pendingOperation.kind === "android"
                ? t("已选择 Android 密文快照。重新解锁后将原子替换本机 Room 密文库、离线队列和同步游标，完成后立即锁定。")
                : t("已选择 Web crypto-core 加密备份。重新解锁后才会在原生层解密并导入。")}
            </Text>
            {pendingOperation.kind === "crypto-core" ? (
              <TextInput
                testID="crypto-core-backup-password"
                accessibilityLabel={t("Web 加密备份密码")}
                style={styles.input}
                value={backupPassword}
                onChangeText={setBackupPassword}
                placeholder={t("Web 备份独立密码")}
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="off"
                importantForAutofill="no"
                maxLength={1024}
              />
            ) : null}
            {vault.localDeviceSecurityState?.unlockState === "PASSWORD_ALLOWED" ? (
              <>
                <TextInput
                  testID="local-backup-master-password"
                  accessibilityLabel={t("Zero Vault 主密码")}
                  style={styles.input}
                  value={masterPassword}
                  onChangeText={setMasterPassword}
                  placeholder={t("Zero Vault 主密码")}
                  placeholderTextColor={colors.textMuted}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="password"
                  importantForAutofill="no"
                  maxLength={1024}
                />
                <ActionButton
                  styles={styles}
                  testID="local-backup-continue-password"
                  label={busy ? t("处理中…") : t("使用主密码继续")}
                  disabled={busy || !masterPassword || (pendingOperation.kind === "crypto-core" && !backupPassword)}
                  onPress={() => confirmPendingOperation("password")}
                />
              </>
            ) : null}
            {vault.localDeviceSecurityState?.unlockState === "BIOMETRIC_READY" ? (
              <ActionButton
                styles={styles}
                testID="local-backup-continue-biometric"
                label={t("使用强生物识别继续")}
                disabled={busy || (pendingOperation.kind === "crypto-core" && !backupPassword)}
                onPress={() => confirmPendingOperation("biometric")}
              />
            ) : null}
            {!vault.localDeviceSecurityState && !vault.localDeviceSecurityFailure ? (
              <Text accessibilityRole="alert" style={styles.warning}>{t("正在验证本机解锁策略，暂不允许继续。")}</Text>
            ) : null}
            {vault.localDeviceSecurityFailure === "RECOVERY_REQUIRED" ? (
              <Text accessibilityRole="alert" style={styles.warning}>
                {t("本机设备身份缺失或校验失败。请取消操作并从解锁页执行安全恢复或重新绑定。")}
              </Text>
            ) : null}
            {vault.localDeviceSecurityFailure === "NATIVE_UNAVAILABLE" ? (
              <Text accessibilityRole="alert" style={styles.warning}>
                {t("本机安全模块不可用。请取消操作并重启应用，当前不会执行恢复或导入。")}
              </Text>
            ) : null}
            {vault.localDeviceSecurityState?.unlockState === "DEVICE_KEY_INVALIDATED" ||
            vault.localDeviceSecurityState?.unlockState === "BIOMETRIC_UNAVAILABLE" ||
            vault.localDeviceSecurityState?.unlockState === "BIOMETRIC_INVALIDATED" ? (
              <Text accessibilityRole="alert" style={styles.warning}>
                {t("生物识别不可用或已失效。请取消操作并从解锁页使用恢复码或可信设备重新绑定。")}
              </Text>
            ) : null}
            <TouchableOpacity
              accessibilityRole="button"
              disabled={busy}
              style={styles.cancelButton}
              onPress={() => { void cancelPendingOperation(); }}
            >
              <Text style={styles.cancelText}>{t("取消待处理操作")}</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("导出 Android 密文快照")}</Text>
          <Text style={styles.help}>{t("包含条目密文、离线变更和同步游标，不导出任何明文 CSV。")}</Text>
          <ActionButton
            styles={styles}
            testID="local-backup-export"
            label={busy ? t("处理中…") : t("导出加密文件")}
            disabled={unavailable || vault.conflictCount > 0}
            onPress={() => { void exportBackup(); }}
          />
          {vault.conflictCount > 0 ? <Text style={styles.warning}>{t("请先解决同步冲突，以免导出不一致快照。")}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("恢复 Android 密文快照")}</Text>
          <Text style={styles.help}>{t("选择文件后应用会保持锁定，并要求使用主密码或强生物识别重新授权。")}</Text>
          <ActionButton
            styles={styles}
            testID="local-backup-restore"
            label={t("选择恢复文件")}
            disabled={unavailable}
            onPress={() => { void restoreBackup(); }}
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("导入 Web crypto-core 备份")}</Text>
          <Text style={styles.help}>
            {t("先选择文件，返回并重新授权后再输入备份独立密码。旧 webcrypto-mvp 备份必须先在 Web 端迁移。")}
          </Text>
          <ActionButton
            styles={styles}
            testID="crypto-core-backup-import"
            label={t("选择 Web 加密备份")}
            disabled={unavailable}
            onPress={() => { void importWebBackup(); }}
          />
        </View>

        {vault.isLocked && !pendingOperation ? <Text style={styles.warning}>{t("请先解锁密码库再执行备份操作。")}</Text> : null}
        {vault.isSyncing ? <Text style={styles.warning}>{t("同步完成后才能执行备份操作。")}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function ActionButton(props: {
  styles: ReturnType<typeof createStyles>;
  testID: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      testID={props.testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      disabled={props.disabled}
      style={[props.styles.button, props.disabled && props.styles.disabled]}
      onPress={props.onPress}
    >
      <Text style={props.styles.buttonText}>{props.label}</Text>
    </TouchableOpacity>
  );
}

function messageFor(cause: unknown): string {
  const code = typeof cause === "object" && cause !== null && "code" in cause
    ? String((cause as { code: unknown }).code)
    : cause instanceof Error ? cause.message : "unknown";
  const messages: Record<string, string> = {
    AUTH_INVALID: "备份认证失败，请检查备份密码、账户和文件完整性。",
    BACKUP_CONFLICTS_PRESENT: "存在未解决的同步冲突，未创建备份。",
    CIPHERTEXT_TAMPERED: "备份认证失败，文件可能已被修改或不属于当前密码库。",
    INVALID_ARGUMENT: "备份文件格式无效、为空或超过允许大小。",
    LEGACY_BACKUP_UNSUPPORTED: "旧 webcrypto-mvp 备份不受支持，请先在 Web 端迁移。",
    backup_account_mismatch: "此 Android 备份属于另一个账户，已拒绝恢复。",
    BACKUP_ACCOUNT_MISMATCH: "此 Android 备份属于另一个账户，已拒绝恢复。",
    BACKUP_DOCUMENT_UNAVAILABLE: "系统当前无法打开文件保存面板。",
    BACKUP_DOCUMENT_FAILED: "系统没有返回可用的备份文件，请重新选择。",
    BACKUP_OPEN_FAILED: "系统无法读取所选备份文件，请检查文件权限后重试。",
    BACKUP_SAVE_FAILED: "加密备份写入失败，未报告导出成功。请重新选择保存位置。",
    BACKUP_SAVE_IN_PROGRESS: "另一项文件保存操作仍在进行，请先完成或取消。",
    BACKUP_STAGE_FAILED: "无法安全暂存所选备份文件，请重新选择。",
    BACKUP_STAGE_NOT_FOUND: "待处理备份已过期或被系统清理，请重新选择文件。",
    BACKUP_OPERATION_IN_PROGRESS: "另一项恢复操作仍在进行，请稍后重试。",
    BACKUP_OPERATION_NOT_FOUND: "待处理备份已过期或被系统清理，请重新选择文件。",
    BACKUP_OPERATION_CANCELLED: "操作已取消，未修改密码库。",
    BACKUP_FILE_TOO_LARGE: "备份文件为空或超过允许大小。",
    INVALID_BACKUP: "备份文件格式无效、为空或已损坏。",
    auth_required: "登录状态已失效，请重新登录后再执行备份操作。",
    operation_cancelled: "操作已取消。",
    UNSUPPORTED_VAULT_FORMAT: "备份加密格式不受支持或文件已损坏。",
    unlocked_local_backup_required: "密码库已锁定，请重新解锁后再执行备份操作。",
  };
  return messages[code] ?? "加密备份操作失败，未修改密码库。请检查文件格式、账户和备份密码。";
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgRoot },
  content: { padding: spacing.base, paddingBottom: spacing.xl + spacing.base, gap: spacing.lg },
  title: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.heading, fontWeight: fontWeight.semibold, letterSpacing: 1.2, textTransform: "uppercase", borderLeftWidth: 6, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  description: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 21, paddingBottom: spacing.xs, borderBottomWidth: 2, borderBottomColor: colors.border },
  error: { color: colors.danger, fontFamily: "monospace", fontSize: fontSize.bodySm },
  warning: { color: colors.warning, fontFamily: "monospace", fontSize: fontSize.caption, lineHeight: 19 },
  card: { backgroundColor: colors.bgPanel, borderWidth: 2, borderColor: colors.borderStrong, padding: spacing.base, gap: spacing.sm, shadowColor: colors.borderStrong, shadowOffset: { width: 4, height: 4 }, shadowOpacity: 1, shadowRadius: 0, elevation: 4 },
  authorizationCard: { borderColor: colors.primary, shadowColor: colors.primary },
  cardTitle: { color: colors.textPrimary, fontFamily: "monospace", fontSize: fontSize.subheading, fontWeight: fontWeight.semibold, letterSpacing: 0.7, borderBottomWidth: 2, borderBottomColor: colors.border, paddingBottom: spacing.xs },
  help: { color: colors.textSecondary, fontSize: fontSize.bodySm, lineHeight: 20 },
  input: { minHeight: minTouchTarget, borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bgRoot, color: colors.textPrimary, paddingHorizontal: spacing.md, fontFamily: "monospace", fontSize: fontSize.body },
  button: { minHeight: minTouchTarget, borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", shadowColor: colors.borderStrong, shadowOffset: { width: 3, height: 3 }, shadowOpacity: 1, shadowRadius: 0, elevation: 3 },
  buttonText: { color: colors.primaryContrast, fontFamily: "monospace", fontSize: fontSize.body, fontWeight: fontWeight.semibold, letterSpacing: 0.7 },
  cancelButton: { minHeight: minTouchTarget, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.borderStrong, backgroundColor: colors.bgRoot },
  cancelText: { color: colors.textSecondary, fontFamily: "monospace", fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  disabled: { opacity: 0.45 },
  });
}
