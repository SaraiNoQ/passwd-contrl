"use client";

import { FormEvent, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockedState } from "../components/shell/locked-state";
import { AppLoadingFallback } from "../components/loading-skeleton";
import { useVaultContext } from "./vault-provider";

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
    />
  );
}
