"use client";

import { useCallback, useState } from "react";
import {
  loginAccount,
  logoutAccount,
  registerAccount,
  fetchCurrentUser,
  pullVault,
  deleteAccount,
  fetchRecoveryPacket,
  saveRecoveryPacketToServer
} from "../lib/api-client";
import {
  getSyncedLocalVaultItem,
  syncItemToEncryptedVault,
  loadLocalServerRevision,
  saveLocalServerRevision
} from "../lib/sync-vault";
import {
  loadEncryptedLocalVault,
  saveEncryptedLocalVault
} from "../lib/local-vault";
import type { UseSettings } from "./useSettings";
import type { UseRecovery } from "./useRecovery";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthUser = {
  id: string;
  email: string;
  serverRevision: number;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(settings: UseSettings, recovery: UseRecovery) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState("");
  const [syncStatus, setSyncStatus] = useState("仅本地");
  const [canRestoreFromCloud, setCanRestoreFromCloud] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPassword, setAccountPassword] = useState("");

  const submitRegister = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (accountPassword.length < 12) {
        throw new Error("账户密码至少需要 12 个字符。");
      }

      const { recoveryCode } = await registerAccount(accountEmail, accountPassword);
      // Show recovery code — this is the ONLY time the user sees it
      recovery.showRecoveryCode(recoveryCode);

      const session = await loginAccount(accountEmail, accountPassword);
      setUser(session.user);
      setCsrfToken(session.csrfToken);
      setAccountPassword("");
      setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);

      const remote = await pullVault().catch(() => null);
      setCanRestoreFromCloud(
        !loadEncryptedLocalVault() && !!remote && getSyncedLocalVaultItem(remote.items) !== null
      );
    },
    [accountEmail, accountPassword, recovery]
  );

  const submitLogin = useCallback(async () => {
    const session = await loginAccount(accountEmail, accountPassword);
    setUser(session.user);
    setCsrfToken(session.csrfToken);
    setAccountPassword("");
    setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);

    const remote = await pullVault().catch(() => null);
    setCanRestoreFromCloud(
      !loadEncryptedLocalVault() && !!remote && getSyncedLocalVaultItem(remote.items) !== null
    );
  }, [accountEmail, accountPassword]);

  const submitLogout = useCallback(async () => {
    if (csrfToken) {
      await logoutAccount(csrfToken).catch(() => undefined);
    }
    setUser(null);
    setCsrfToken("");
    setSyncStatus("仅本地");
    setCanRestoreFromCloud(false);
  }, [csrfToken]);

  const restoreFromCloud = useCallback(async () => {
    if (!user) throw new Error("请先登录。");

    const remote = await pullVault();
    const syncedItem = getSyncedLocalVaultItem(remote.items);
    if (!syncedItem) throw new Error("服务器上没有可恢复的加密密码库。");

    const restored = syncItemToEncryptedVault(syncedItem);
    saveEncryptedLocalVault(restored);
    saveLocalServerRevision(remote.serverRevision);
    setCanRestoreFromCloud(false);
    setSyncStatus(`已恢复加密密码库 · 版本 ${remote.serverRevision}`);

    return restored;
  }, [user]);

  const handleDeleteAccount = useCallback(async () => {
    if (csrfToken) {
      try {
        await deleteAccount(csrfToken);
      } catch {
        // Server deletion failed, still clear local data
      }
    }
    // Clear all local data
    ["zero-vault.local.encrypted-vault.v1",
     "zero-vault.local.sync-revision.v1",
     "zero-vault.local.item-revisions.v1",
     "zero-vault.local.conflict-ids.v1",
     "zero-vault.local.last-synced-at.v1",
     "zero-vault.local.recovery-packet.v1",
     "zero-vault.local.device-id.v1",
     "zero-vault.local.device-id.v1.public-key"
    ].forEach((key) => localStorage.removeItem(key));
    settings.clearAllSettings();
    setUser(null);
    setCsrfToken("");
    setSyncStatus("仅本地");
    setCanRestoreFromCloud(false);
  }, [csrfToken, settings]);

  const bootstrapSession = useCallback(async () => {
    try {
      const session = await fetchCurrentUser();
      setUser(session.user);
      setCsrfToken(session.csrfToken);
      setSyncStatus(`已登录 · 版本 ${session.user.serverRevision}`);

      if (!loadEncryptedLocalVault()) {
        const remote = await pullVault().catch(() => null);
        setCanRestoreFromCloud(
          !!remote && getSyncedLocalVaultItem(remote.items) !== null
        );
      }
    } catch {
      // Not logged in, that's fine
    }
  }, []);

  return {
    user,
    setUser,
    csrfToken,
    setCsrfToken,
    syncStatus,
    setSyncStatus,
    canRestoreFromCloud,
    setCanRestoreFromCloud,
    accountEmail,
    setAccountEmail,
    accountPassword,
    setAccountPassword,
    submitRegister,
    submitLogin,
    submitLogout,
    restoreFromCloud,
    handleDeleteAccount,
    bootstrapSession
  };
}
