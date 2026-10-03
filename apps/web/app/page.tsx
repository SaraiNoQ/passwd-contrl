"use client";

import { FormEvent, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockedState } from "../components/shell/locked-state";
import { AppLoadingFallback } from "../components/loading-skeleton";
import { useVaultContext } from "./vault-provider";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import styles from "../components/shell/locked-state.module.css";
import { getDeviceFingerprint } from "../lib/device-trust";

export default function HomePage() {
  const ctx = useVaultContext();
  const router = useRouter();

  // Redirect to /vault when vault is unlocked
  useEffect(() => {
    if (!ctx.isLocked) {
      router.replace("/vault");
    }
  }, [ctx.isLocked, router]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      const didOpenVault = await (ctx.hasLocalVault ? ctx.unlockVault : ctx.createVault)(e);
      if (didOpenVault) {
        router.replace("/vault");
      }
    },
    [ctx, router]
  );

  if (!ctx.isLocked) {
    return <AppLoadingFallback variant="vault" />;
  }

  return (
    <LockedState
      hasLocalVault={ctx.hasLocalVault}
      masterPassword={ctx.masterPassword}
      onMasterPasswordChange={ctx.setMasterPassword}
      onSubmit={handleSubmit}
      loading={ctx.loading}
      {...(ctx.loadingMessage ? { statusMessage: ctx.loadingMessage } : {})}
      extensionBridge={ctx.extensionBridge}
      showRecoveryEntry={ctx.showRecoveryEntry}
      onToggleRecoveryEntry={() => ctx.setShowRecoveryEntry((v) => !v)}
      recoveryInputCode={ctx.recoveryInputCode}
      onRecoveryInputCodeChange={ctx.setRecoveryInputCode}
      recoveryPassword={ctx.recoveryPassword}
      onRecoveryPasswordChange={ctx.setRecoveryPassword}
      onRecoverVault={() => void ctx.handleRecoverVault()}
      error={ctx.error}
      cloudConnection={
        <details className={styles.cloudConnection}>
          <summary>已有手机密码库？连接已有账户</summary>
          <form onSubmit={(event) => { event.preventDefault(); void ctx.connectCloudVault(); }}>
            <p>登录后，在手机的设备管理中批准此浏览器。上方主密码用于保护这台浏览器的本地副本。</p>
            <Input id="cloud-account-email" label="账户邮箱" inputMode="email" autoComplete="username" value={ctx.accountEmail} onChange={(event) => ctx.setAccountEmail(event.target.value)} disabled={ctx.loading} />
            <Input id="cloud-account-password" label="账户密码" type="password" autoComplete="current-password" value={ctx.accountPassword} onChange={(event) => ctx.setAccountPassword(event.target.value)} disabled={ctx.loading} />
            {ctx.user ? <p role="status">已登录 {ctx.user.email}。在手机批准后，再次点击连接。</p> : null}
            {ctx.user ? <p>浏览器指纹：<code>{getDeviceFingerprint()}</code></p> : null}
            <Button type="submit" variant="secondary" loading={ctx.loading}>连接云端密码库</Button>
          </form>
        </details>
      }
    />
  );
}
