import { describe, expect, it } from "vitest";
import { getSessionGuardTarget, type SessionRouteState } from "../lib/session-route-guard";

const READY: SessionRouteState = {
  isRestoring: false,
  hasUser: true,
  hasRecoveryCode: false,
  deviceStatus: "approved",
  vaultLocked: false,
};

describe("session route guard", () => {
  it("orders recovery, device approval and vault lock gates ahead of protected routes", () => {
    expect(getSessionGuardTarget("/credential/secret", {
      ...READY,
      hasRecoveryCode: true,
    })).toBe("/recovery-code");
    expect(getSessionGuardTarget("/credential/secret", {
      ...READY,
      deviceStatus: "pending",
    })).toBe("/device-approval");
    expect(getSessionGuardTarget("/credential/secret", {
      ...READY,
      vaultLocked: true,
    })).toBe("/unlock");
  });

  it("keeps anonymous auth and recovery routes reachable but rejects protected deep links", () => {
    const anonymous = { ...READY, hasUser: false };
    expect(getSessionGuardTarget("/register", anonymous)).toBeNull();
    expect(getSessionGuardTarget("/recovery", anonymous)).toBeNull();
    expect(getSessionGuardTarget("/credential/secret", anonymous)).toBe("/login");
  });

  it("preserves registration and device recovery continuations", () => {
    expect(getSessionGuardTarget("/recovery-code", {
      ...READY,
      hasRecoveryCode: true,
    })).toBeNull();
    expect(getSessionGuardTarget("/device-approval", {
      ...READY,
      deviceStatus: "pending",
    })).toBeNull();
    expect(getSessionGuardTarget("/recovery", {
      ...READY,
      deviceStatus: "pending",
      vaultLocked: true,
    })).toBeNull();
    expect(getSessionGuardTarget("/recovery-code", {
      ...READY,
      vaultLocked: true,
    })).toBeNull();
  });

  it("keeps encrypted backup reauthorization mounted after the document picker locks the vault", () => {
    expect(getSessionGuardTarget("/local-backup", {
      ...READY,
      vaultLocked: true,
    })).toBeNull();
    expect(getSessionGuardTarget("/local-backup", {
      ...READY,
      hasUser: false,
      vaultLocked: true,
    })).toBe("/login");
    expect(getSessionGuardTarget("/local-backup", {
      ...READY,
      deviceStatus: "pending",
      vaultLocked: true,
    })).toBe("/device-approval");
  });
});
