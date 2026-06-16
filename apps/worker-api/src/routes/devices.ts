import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { registerDeviceRequestSchema } from "@zero-vault/shared";

export function buildDeviceRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── GET /devices ─────────────────────────────────────────────────────────
  app.get("/devices", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const devices = await store.listDevices(session.userId);
    return c.json({ devices });
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
      publicKey: parsed.data.publicKey,
      status: "pending" as const,
      createdAt: now,
      updatedAt: now
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
      await store.approveDevice(session.userId, deviceId);
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

    // Verify the device exists and belongs to this user
    const devices = await store.listDevices(session.userId);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      return c.json({ error: "device_not_found" }, 404);
    }

    if (device.status !== "approved") {
      return c.json({ error: "device_not_approved" }, 403);
    }

    const encryptedVaultKey = await store.getDeviceVaultKey(session.userId, deviceId);
    if (!encryptedVaultKey) {
      return c.json({ error: "key_not_shared" }, 404);
    }

    return c.json({ encryptedVaultKey });
  });

  // ── POST /devices/:id/share-key ─────────────────────────────────────────
  app.post("/devices/:id/share-key", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const deviceId = c.req.param("id");
    const body = await c.req.json();
    const encryptedVaultKey = body.encryptedVaultKey;

    if (typeof encryptedVaultKey !== "string" || encryptedVaultKey.length === 0) {
      return c.json({ error: "encrypted_vault_key_required" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    // Verify the device exists and belongs to this user
    const devices = await store.listDevices(session.userId);
    const device = devices.find((d) => d.id === deviceId);
    if (!device) {
      return c.json({ error: "device_not_found" }, 404);
    }

    await store.saveDeviceVaultKey(session.userId, deviceId, encryptedVaultKey);
    return c.json({ ok: true });
  });

  return app;
}
