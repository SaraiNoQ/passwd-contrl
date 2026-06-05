import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { recoveryPacketRequestSchema } from "@zero-vault/shared";

export function buildRecoveryRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── GET /vault/recovery-packet ───────────────────────────────────────────
  app.get("/vault/recovery-packet", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const store = new D1VaultStore(c.env.DB);
    const packet = await store.getRecoveryPacket(session.userId);
    if (!packet) {
      return c.json({ error: "recovery_packet_not_found" }, 404);
    }
    return c.json({ encryptedRecoveryPacket: packet });
  });

  // ── POST /vault/recovery-packet ──────────────────────────────────────────
  app.post("/vault/recovery-packet", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);

    const body = await c.req.json();
    const parsed = recoveryPacketRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_recovery_packet_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    await store.rotateRecoveryPacket(session.userId, parsed.data.encryptedRecoveryPacket);
    return c.json({ ok: true });
  });

  return app;
}
