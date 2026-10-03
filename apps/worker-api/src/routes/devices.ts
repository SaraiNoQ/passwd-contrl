import { Hono } from "hono";
import type { Context } from "hono";
import type { Env } from "../env";
import { convertLegacyDeviceVaultKeyPacket, D1VaultStore } from "../store";
import { deviceVaultKeyRequestSchema, registerDeviceRequestSchema } from "@zero-vault/shared";
import type { DeviceVaultKeyPacket, TrustedDevice } from "@zero-vault/shared";
import { publicKeyFingerprint } from '../utils/crypto';

type DeviceRouteContext = Context<{ Bindings: Env }>;
// A claimed SHA-256 fingerprint must be derived from the actual packet recipient
// key when displayed, including devices registered through legacy routes.
async function verifiedFingerprint(device: TrustedDevice): Promise<TrustedDevice> {
  if (!device.fingerprint || !/^[a-f0-9]{64}$/i.test(device.fingerprint)) return device;
  try { return { ...device, fingerprint: await publicKeyFingerprint(device.publicKey) }; }
  catch { const { fingerprint: _unverified, ...rest } = device; return rest; }
}
type RequestWithCf = Request & {
  cf?: Record<string, unknown>;
};

const normalizeText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const getClientIp = (c: DeviceRouteContext): string | null => {
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    normalizeText(c.req.header("cf-connecting-ip")) ??
    normalizeText(forwardedFor) ??
    normalizeText(c.req.header("x-real-ip"))
  );
};

const getClientLocation = (c: DeviceRouteContext): string | null => {
  const cf = (c.req.raw as RequestWithCf).cf;
  const parts = [
    normalizeText(cf?.city),
    normalizeText(cf?.region),
    normalizeText(cf?.country) ?? normalizeText(c.req.header("cf-ipcountry"))
  ].filter((part): part is string => Boolean(part));

  if (parts.length > 0) return parts.join(" · ");

  const colo = normalizeText(cf?.colo);
  return colo ? `Cloudflare ${colo}` : null;
};

const isStrictEmptyObject = (value: unknown): value is Record<string, never> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  Object.keys(value).length === 0;

const legacyRawVaultKey = (value: unknown): string | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.encryptedVaultKey === "string"
    ? record.encryptedVaultKey
    : null;
};

const isLegacyDesktopSession = (session: {
  authTransport: "cookie" | "bearer";
  deviceId: string | null;
}): boolean => session.authTransport === "cookie" && session.deviceId === null;

const parseDeviceVaultKeyPacket = (
  body: unknown,
  device: TrustedDevice
): DeviceVaultKeyPacket | null => {
  const structured = deviceVaultKeyRequestSchema.safeParse(body);
  if (structured.success) return structured.data.encryptedVaultKeyPacket;
  const legacyRaw = legacyRawVaultKey(body);
  return legacyRaw ? convertLegacyDeviceVaultKeyPacket(legacyRaw, device) : null;
};

export function buildDeviceRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── GET /devices ─────────────────────────────────────────────────────────
  app.get("/devices", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const devices = await store.listDevices(session.userId);
    return c.json({ devices: await Promise.all(devices.map(verifiedFingerprint)) });
  });

  // Pending bearer sessions may only poll their own approval state.
  app.get("/devices/self", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    if (!session.deviceId) return c.json({ error: "mobile_device_required" }, 400);

    const store = new D1VaultStore(c.env.DB);
    const device = await store.getDevice(session.userId, session.deviceId);
    if (!device) return c.json({ error: "device_not_found" }, 404);
    return c.json({ device: await verifiedFingerprint(device) });
  });

  // ── POST /devices ────────────────────────────────────────────────────────
  app.post("/devices", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const body = await c.req.json();
    const parsed = registerDeviceRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_register_device_request" }, 400);
    }

    const now = new Date().toISOString();
    const device = {
      id: crypto.randomUUID(),
      name: parsed.data.name,
      fingerprint: parsed.data.fingerprint,
      publicKey: parsed.data.publicKey,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
      lastSeenIp: getClientIp(c),
      lastSeenLocation: getClientLocation(c)
    };

    const store = new D1VaultStore(c.env.DB);
    const registeredDevice = await store.registerDevice(session.userId, device);
    return c.json(registeredDevice, registeredDevice.id === device.id ? 201 : 200);
  });

  // ── POST /devices/:id/approve ────────────────────────────────────────────
  app.post("/devices/:id/approve", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    const store = new D1VaultStore(c.env.DB);
    try {
      if (session.deviceId === deviceId) {
        return c.json({ error: "device_cannot_self_approve" }, 403);
      }
      const device = await store.getDevice(session.userId, deviceId);
      if (!device) return c.json({ error: "device_not_found" }, 404);

      let body: unknown = undefined;
      const rawBody = await c.req.text();
      if (rawBody.length > 0) {
        try {
          body = JSON.parse(rawBody) as unknown;
        } catch {
          return c.json({ error: "invalid_device_vault_key_packet" }, 400);
        }
      }

      // Deprecated Desktop flow calls approve({}) and immediately follows with
      // share-key(raw104). For cookie sessions only, acknowledge this strict
      // empty marker without changing state; share-key performs the atomic
      // packet+approval transition. Bearer/mobile callers must use the
      // structured packet in this request.
      if (isStrictEmptyObject(body)) {
        if (!isLegacyDesktopSession(session)) {
          return c.json({ error: "invalid_device_vault_key_packet" }, 400);
        }
        if (device.status !== "pending" && device.status !== "approved") {
          return c.json({ error: "device_not_pending" }, 409);
        }
        return c.json({ ok: true });
      }

      if (legacyRawVaultKey(body) !== null && !isLegacyDesktopSession(session)) {
        return c.json({ error: "invalid_device_vault_key_packet" }, 400);
      }

      const packet = parseDeviceVaultKeyPacket(body, device);
      if (!packet) return c.json({ error: "invalid_device_vault_key_packet" }, 400);
      if (packet.recipientDeviceId !== device.id || packet.recipientPublicKey !== device.publicKey) {
        return c.json({ error: "vault_key_packet_recipient_mismatch" }, 400);
      }

      if (device.status === "approved") {
        const existing = await store.getDeviceVaultKey(session.userId, deviceId);
        if (existing && JSON.stringify(existing) === JSON.stringify(packet)) {
          return c.json({ ok: true });
        }
        return c.json({ error: "device_not_pending" }, 409);
      }
      if (device.status !== "pending") return c.json({ error: "device_not_pending" }, 409);
      await store.approveDeviceWithVaultKey(session.userId, deviceId, packet);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === "device_not_found") {
        return c.json({ error: "device_not_found" }, 404);
      }
      throw error;
    }
  });

  // ── POST /devices/:id/reject ─────────────────────────────────────────────
  app.post("/devices/:id/reject", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    const store = new D1VaultStore(c.env.DB);

    try {
      if (session.deviceId === deviceId) {
        return c.json({ error: "device_cannot_self_reject" }, 403);
      }
      const device = await store.getDevice(session.userId, deviceId);
      if (!device) return c.json({ error: "device_not_found" }, 404);
      if (device.status !== "pending") {
        return c.json({ error: "device_not_pending" }, 409);
      }
      await store.rejectDevice(session.userId, deviceId);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === "device_not_found") {
        return c.json({ error: "device_not_found" }, 404);
      }
      throw error;
    }
  });

  // ── POST /devices/:id/revoke ─────────────────────────────────────────────
  app.post("/devices/:id/revoke", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    const store = new D1VaultStore(c.env.DB);
    try {
      await store.revokeDevice(session.userId, deviceId);
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof Error && error.message === "device_not_found") {
        return c.json({ error: "device_not_found" }, 404);
      }
      throw error;
    }
  });

  // ── GET /devices/:id/key ──────────────────────────────────────────────────
  app.get("/devices/:id/key", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    const store = new D1VaultStore(c.env.DB);

    // A device-bound bearer may download only the packet encrypted for that
    // exact device. Do this before existence checks so other device ids are not
    // an oracle. Cookie sessions remain compatible with the Web trust flow.
    if (session.authTransport === "bearer" && session.deviceId !== deviceId) {
      return c.json({ error: "device_key_access_denied" }, 403);
    }

    // Verify the device exists and belongs to this user
    const devices = await store.listDevices(session.userId);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      return c.json({ error: "device_not_found" }, 404);
    }

    if (device.status !== "approved") {
      return c.json({ error: "device_not_approved" }, 403);
    }

    const encryptedVaultKeyPacket = await store.getDeviceVaultKey(session.userId, deviceId);
    if (!encryptedVaultKeyPacket) {
      return c.json({ error: "key_not_shared" }, 404);
    }

    return c.json({ encryptedVaultKeyPacket });
  });

  // ── POST /devices/:id/share-key ─────────────────────────────────────────
  app.post("/devices/:id/share-key", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_device_vault_key_packet" }, 400);
    }
    const store = new D1VaultStore(c.env.DB);

    // Verify the device exists and belongs to this user
    const devices = await store.listDevices(session.userId);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      return c.json({ error: "device_not_found" }, 404);
    }

    if (device.status !== "pending" && device.status !== "approved") {
      return c.json({ error: "device_not_eligible" }, 409);
    }

    if (legacyRawVaultKey(body) !== null && !isLegacyDesktopSession(session)) {
      return c.json({ error: "invalid_device_vault_key_packet" }, 400);
    }

    const packet = parseDeviceVaultKeyPacket(body, device);
    if (!packet) return c.json({ error: "invalid_device_vault_key_packet" }, 400);
    if (packet.recipientDeviceId !== device.id || packet.recipientPublicKey !== device.publicKey) {
      return c.json({ error: "vault_key_packet_recipient_mismatch" }, 400);
    }

    if (device.status === "pending") {
      await store.approveDeviceWithVaultKey(session.userId, deviceId, packet);
    } else {
      await store.saveDeviceVaultKey(session.userId, deviceId, packet);
    }
    return c.json({ ok: true });
  });

  return app;
}
