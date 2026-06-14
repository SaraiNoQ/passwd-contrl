import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./device-trust", () => ({
  approveDevice: vi.fn(async () => ({ ok: true })),
  rejectDevice: vi.fn(async () => ({ ok: true })),
  revokeDevice: vi.fn(async () => ({ ok: true })),
  listDevices: vi.fn(async () => [
    { id: "dev-1", name: "Device 1", publicKey: "pk1", status: "approved" },
    { id: "dev-2", name: "Device 2", publicKey: "pk2", status: "pending" },
  ]),
  getDeviceId: vi.fn(() => "dev-1"),
  encryptVaultKeyForDevice: vi.fn(async () => new Uint8Array([1, 2, 3])),
  shareVaultKeyWithDevice: vi.fn(async () => ({ ok: true })),
}));

const { handleRefreshDevices, handleApproveDevice, handleRejectDevice, handleRevokeDevice } = await import("./vault-device");
const { approveDevice, rejectDevice, revokeDevice, listDevices, getDeviceId } = await import("./device-trust");

describe("handleRefreshDevices", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns devices and current device ID", async () => {
    const result = await handleRefreshDevices({ csrfToken: "token" });
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.devices).toHaveLength(2);
      expect(result.currentDeviceId).toBe("dev-1");
    }
  });

  it("returns not-logged-in without csrfToken", async () => {
    const result = await handleRefreshDevices({ csrfToken: "" });
    expect(result.status).toBe("not-logged-in");
  });

  it("returns error on failure", async () => {
    vi.mocked(listDevices).mockRejectedValueOnce(new Error("network_error"));
    const result = await handleRefreshDevices({ csrfToken: "token" });
    expect(result.status).toBe("error");
  });
});

describe("handleApproveDevice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("approves device and shares vault key", async () => {
    const mockVault = {
      runtime: "crypto-core-wasm",
      key: new Uint8Array(32),
    } as Parameters<typeof handleApproveDevice>[0]["unlockedVault"];
    const result = await handleApproveDevice({
      csrfToken: "token",
      deviceId: "dev-2",
      unlockedVault: mockVault,
      devices: [{ id: "dev-2", name: "Device 2", publicKey: "pk2", status: "pending" }],
    });
    expect(result.status).toBe("ok");
    expect(approveDevice).toHaveBeenCalledWith("token", "dev-2");
  });

  it("returns not-logged-in without csrfToken", async () => {
    const result = await handleApproveDevice({
      csrfToken: "",
      deviceId: "dev-2",
      unlockedVault: null,
      devices: [],
    });
    expect(result.status).toBe("not-logged-in");
  });
});

describe("handleRejectDevice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects device", async () => {
    const result = await handleRejectDevice({ csrfToken: "token", deviceId: "dev-2" });
    expect(result.status).toBe("ok");
    expect(rejectDevice).toHaveBeenCalledWith("token", "dev-2");
  });

  it("returns not-logged-in without csrfToken", async () => {
    const result = await handleRejectDevice({ csrfToken: "", deviceId: "dev-2" });
    expect(result.status).toBe("not-logged-in");
  });
});

describe("handleRevokeDevice", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes device", async () => {
    const result = await handleRevokeDevice({ csrfToken: "token", deviceId: "dev-1" });
    expect(result.status).toBe("ok");
    expect(revokeDevice).toHaveBeenCalledWith("token", "dev-1");
  });

  it("returns not-logged-in without csrfToken", async () => {
    const result = await handleRevokeDevice({ csrfToken: "", deviceId: "dev-1" });
    expect(result.status).toBe("not-logged-in");
  });
});
