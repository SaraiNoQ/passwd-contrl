"use client";

import { FormEvent, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LockedState } from "../components/shell/locked-state";
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
    (e: FormEvent<HTMLFormElement>) => {
      void (ctx.hasLocalVault ? ctx.unlockVault : ctx.createVault)(e);
    },
    [ctx]
  );

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
