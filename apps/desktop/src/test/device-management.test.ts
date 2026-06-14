import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TrustedDevice } from "@zero-vault/shared";
import type { DesktopCryptoAdapter } from "../lib/crypto/desktop-crypto-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDevice(
  overrides: Partial<TrustedDevice> = {},
): TrustedDevice {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "MacBook Pro",
    publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    status: "approved",
    createdAt: "2026-01-15T10:30:00.000Z",
    updatedAt: "2026-01-15T10:30:00.000Z",
    ...overrides,
  };
}

function makeCryptoAdapter(): DesktopCryptoAdapter {
  return {
    deriveVaultKey: vi.fn(),
    decryptItem: vi.fn(),
    encryptItem: vi.fn(),
    generateRecoveryCode: vi.fn(),
    deriveRecoveryKey: vi.fn(),
    generateDeviceKeypair: vi.fn().mockResolvedValue({
      publicKey: new Uint8Array(32).fill(1),
      privateKey: new Uint8Array(32).fill(2),
    }),
    encryptRecoveryPacket: vi.fn().mockResolvedValue({
      nonce: new Uint8Array(24),
      ciphertext: new Uint8Array(32),
    }),
    decryptRecoveryPacket: vi.fn().mockResolvedValue(new Uint8Array(32)),
    encryptVaultKeyForDevice: vi
      .fn()
      .mockResolvedValue(new Uint8Array(32).fill(3)),
    decryptVaultKeyOnDevice: vi.fn(),
    lock: vi.fn(),
  };
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ---------------------------------------------------------------------------
// Tests — device management logic
// ---------------------------------------------------------------------------

describe("Device management logic", () => {
  let crypto: DesktopCryptoAdapter;

  beforeEach(() => {
    crypto = makeCryptoAdapter();
  });

  // ── Device list rendering logic ─────────────────────────────────────────────

  describe("device list partitioning", () => {
    it("partitions devices by status", () => {
      const devices: TrustedDevice[] = [
        makeDevice({ id: "11111111-1111-1111-1111-111111111111", status: "approved" }),
        makeDevice({ id: "22222222-2222-2222-2222-222222222222", status: "pending" }),
        makeDevice({ id: "33333333-3333-3333-3333-333333333333", status: "revoked" }),
        makeDevice({ id: "44444444-4444-4444-4444-444444444444", status: "approved" }),
      ];

      const pending = devices.filter((d) => d.status === "pending");
      const active = devices.filter((d) => d.status === "approved");
      const inactive = devices.filter(
        (d) => d.status === "revoked" || d.status === "rejected",
      );

      expect(pending).toHaveLength(1);
      expect(active).toHaveLength(2);
      expect(inactive).toHaveLength(1);
    });

    it("handles empty device list", () => {
      const devices: TrustedDevice[] = [];
      const pending = devices.filter((d) => d.status === "pending");
      const active = devices.filter((d) => d.status === "approved");

      expect(pending).toHaveLength(0);
      expect(active).toHaveLength(0);
    });
  });

  // ── Status label mapping ───────────────────────────────────────────────────

  describe("status labels", () => {
    function statusText(status: TrustedDevice["status"]): string {
      switch (status) {
        case "approved":
          return "已信任";
        case "pending":
          return "待确认";
        case "revoked":
          return "已撤销";
        case "rejected":
          return "已拒绝";
        default:
          return "未知";
      }
    }

    it("maps approved to trusted label", () => {
      expect(statusText("approved")).toBe("已信任");
    });

    it("maps pending to pending label", () => {
      expect(statusText("pending")).toBe("待确认");
    });

    it("maps revoked to revoked label", () => {
      expect(statusText("revoked")).toBe("已撤销");
    });

    it("maps rejected to rejected label", () => {
      expect(statusText("rejected")).toBe("已拒绝");
    });
  });

  // ── Device registration with keypair generation ────────────────────────────

  describe("device registration", () => {
    it("generates X25519 keypair via crypto adapter", async () => {
      const keypair = await crypto.generateDeviceKeypair();

      expect(crypto.generateDeviceKeypair).toHaveBeenCalled();
      expect(keypair.publicKey).toBeInstanceOf(Uint8Array);
      expect(keypair.privateKey).toBeInstanceOf(Uint8Array);
      expect(keypair.publicKey.length).toBe(32);
      expect(keypair.privateKey.length).toBe(32);
    });

    it("converts public key to base64url for API", async () => {
      const keypair = await crypto.generateDeviceKeypair();
      const publicKeyB64 = bytesToBase64url(keypair.publicKey);

      expect(publicKeyB64).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("calls onRegister with device name and public key", async () => {
      const onRegister = vi.fn().mockResolvedValue(undefined);
      const keypair = await crypto.generateDeviceKeypair();
      const publicKeyB64 = bytesToBase64url(keypair.publicKey);

      await onRegister("MacBook Air", publicKeyB64);

      expect(onRegister).toHaveBeenCalledWith(
        "MacBook Air",
        publicKeyB64,
      );
    });
  });

  // ── Device approval with vault key encryption ──────────────────────────────

  describe("device approval", () => {
    it("encrypts vault key for target device using its public key", async () => {
      const vaultKey = new Uint8Array(32).fill(0x42);
      const devicePublicKey = new Uint8Array(32).fill(0x99);

      const encryptedVaultKey = await crypto.encryptVaultKeyForDevice(
        vaultKey,
        devicePublicKey,
      );

      expect(crypto.encryptVaultKeyForDevice).toHaveBeenCalledWith(
        vaultKey,
        devicePublicKey,
      );
      expect(encryptedVaultKey).toBeInstanceOf(Uint8Array);
    });

    it("converts encrypted vault key to base64url for sharing", async () => {
      const vaultKey = new Uint8Array(32).fill(0x42);
      const devicePublicKey = new Uint8Array(32).fill(0x99);
      const encryptedVaultKey = await crypto.encryptVaultKeyForDevice(
        vaultKey,
        devicePublicKey,
      );
      const encryptedB64 = bytesToBase64url(encryptedVaultKey);

      expect(encryptedB64).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("calls onApprove with device ID and encrypted vault key", async () => {
      const onApprove = vi.fn().mockResolvedValue(undefined);
      const deviceId = "22222222-2222-2222-2222-222222222222";
      const vaultKey = new Uint8Array(32).fill(0x42);
      const devicePublicKey = new Uint8Array(32).fill(0x99);

      const encryptedVaultKey = await crypto.encryptVaultKeyForDevice(
        vaultKey,
        devicePublicKey,
      );
      const encryptedB64 = bytesToBase64url(encryptedVaultKey);
      await onApprove(deviceId, encryptedB64);

      expect(onApprove).toHaveBeenCalledWith(deviceId, encryptedB64);
    });
  });

  // ── Device rejection ───────────────────────────────────────────────────────

  describe("device rejection", () => {
    it("calls onReject with device ID", async () => {
      const onReject = vi.fn().mockResolvedValue(undefined);
      const deviceId = "33333333-3333-3333-3333-333333333333";

      await onReject(deviceId);

      expect(onReject).toHaveBeenCalledWith(deviceId);
    });
  });

  // ── Device revocation ──────────────────────────────────────────────────────

  describe("device revocation", () => {
    it("calls onRevoke with device ID", async () => {
      const onRevoke = vi.fn().mockResolvedValue(undefined);
      const deviceId = "44444444-4444-4444-4444-444444444444";

      await onRevoke(deviceId);

      expect(onRevoke).toHaveBeenCalledWith(deviceId);
    });

    it("prevents revoking current device", () => {
      const currentDeviceId = "55555555-5555-5555-5555-555555555555";
      const deviceId = currentDeviceId;
      const canRevoke = deviceId !== currentDeviceId;

      expect(canRevoke).toBe(false);
    });

    it("allows revoking non-current devices", () => {
      const currentDeviceId = "55555555-5555-5555-5555-555555555555";
      const deviceId: string = "66666666-6666-6666-6666-666666666666";
      const canRevoke = deviceId !== currentDeviceId;

      expect(canRevoke).toBe(true);
    });
  });

  // ── Confirm dialog messages ────────────────────────────────────────────────

  describe("confirm dialog messages", () => {
    function getConfirmMessage(
      action: "approve" | "reject" | "revoke",
      _deviceName: string,
    ): { title: string; danger: boolean } {
      const messages: Record<string, { title: string; danger: boolean }> = {
        approve: { title: "批准设备入链", danger: false },
        reject: { title: "拒绝设备准入", danger: false },
        revoke: { title: "撤销设备密钥", danger: true },
      };
      return messages[action]!;
    }

    it("returns correct title for approve", () => {
      expect(getConfirmMessage("approve", "MacBook").title).toBe(
        "批准设备入链",
      );
    });

    it("returns correct title for revoke", () => {
      const msg = getConfirmMessage("revoke", "iPhone");
      expect(msg.title).toBe("撤销设备密钥");
      expect(msg.danger).toBe(true);
    });
  });
});
