/**
 * Session middleware for Hono.
 *
 * Reads the session token from an Android bearer header or Web cookie, looks it up in D1 by token hash,
 * and attaches the user + session metadata to the Hono context.
 * Returns 401 if the session is expired, not found, or the cookie is missing.
 */

import type { MiddlewareHandler } from "hono";
import { parseCookies, SESSION_COOKIE_NAME } from "../utils/cookies";
import { hashToken } from "../utils/crypto";

/** User fields available after session resolution. */
export interface SessionUser {
  id: string;
  email: string;
  serverRevision: number;
  opaqueRegistrationRecord: string;
  publicKeyBundle: string;
  authEpoch: number;
}

/** Full session context attached to Hono's c.set(). */
export interface SessionData {
  id: string;
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
  authTransport: "cookie" | "bearer";
  deviceId: string | null;
  deviceStatus: "pending" | "approved" | null;
  authEpoch: number;
  createdAt: string;
  user: SessionUser;
}

declare module "hono" {
  interface ContextVariableMap {
    session: SessionData;
    csrfToken: string;
    userId: string;
  }
}

/**
 * Session middleware factory.
 * Attaches `session`, `csrfToken`, and `userId` to the Hono context.
 *
 * Does NOT return 401 — use `requireSession()` for protected routes.
 * This allows the middleware to run on all routes without blocking
 * unauthenticated endpoints like /auth/login.
 */
export const sessionMiddleware = (): MiddlewareHandler => {
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    const bearerMatch = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
    const cookieHeader = c.req.header("cookie") ?? "";
    const cookies = parseCookies(cookieHeader);
    const token = authorization === undefined ? cookies[SESSION_COOKIE_NAME] : bearerMatch?.[1];
    const authTransport = authorization === undefined ? "cookie" : "bearer";

    if (!token) {
      await next();
      return;
    }

    const tokenHash = await hashToken(token);
    const db = c.env.DB;

    if (!db) {
      await next();
      return;
    }

    const stmt = db.prepare(
      `SELECT s.id AS session_id, s.user_id, s.csrf_token, s.device_id,
              s.auth_epoch, s.expires_at, s.created_at AS session_created_at,
              u.id as uid, u.email, u.server_revision, u.auth_epoch AS user_auth_epoch,
              u.opaque_registration_record, u.public_key_bundle,
              d.status AS device_status
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN trusted_devices d ON d.id = s.device_id AND d.user_id = s.user_id
       WHERE s.token_hash = ? AND s.auth_epoch = u.auth_epoch`
    );
    const row = (await stmt.bind(tokenHash).first()) as {
      user_id: string;
      session_id: string;
      csrf_token: string;
      device_id: string | null;
      device_status: "pending" | "approved" | "rejected" | "revoked" | null;
      auth_epoch: number;
      user_auth_epoch: number;
      expires_at: string;
      session_created_at: string;
      uid: string;
      email: string;
      server_revision: number;
      opaque_registration_record: string;
      public_key_bundle: string;
    } | null;

    if (!row) {
      await next();
      return;
    }

    // Check expiry
    if (new Date(row.expires_at) < new Date()) {
      // Clean up expired session lazily
      await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
      await next();
      return;
    }

    const deviceId = row.device_id ?? null;
    const deviceStatus = row.device_status ?? null;
    // Bearer sessions are fail-closed unless they are bound to a live device.
    // New Web sessions also bind a device; legacy unbound cookies remain compatible.
    if (
      (authTransport === "bearer" &&
        (!deviceId || (deviceStatus !== "pending" && deviceStatus !== "approved"))) ||
      (authTransport === "cookie" && deviceId !== null && deviceStatus !== "pending" && deviceStatus !== "approved")
    ) {
      await next();
      return;
    }

    const sessionData: SessionData = {
      id: row.session_id,
      userId: row.user_id,
      tokenHash,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      authTransport,
      deviceId,
      deviceStatus: deviceStatus === "pending" || deviceStatus === "approved" ? deviceStatus : null,
      authEpoch: row.auth_epoch,
      createdAt: row.session_created_at,
      user: {
        id: row.uid,
        email: row.email,
        serverRevision: row.server_revision,
        opaqueRegistrationRecord: row.opaque_registration_record,
        publicKeyBundle: row.public_key_bundle,
        authEpoch: row.user_auth_epoch
      }
    };

    c.set("session", sessionData);
    c.set("csrfToken", row.csrf_token);
    c.set("userId", row.user_id);

    if (deviceId !== null && deviceStatus === "pending") {
      const pendingAllowed =
        (c.req.method === "GET" && ["/auth/me", "/auth/session", "/devices/self"].includes(c.req.path)) ||
        (c.req.method === "POST" && c.req.path === "/auth/logout");
      if (!pendingAllowed) {
        return c.json({ error: "device_approval_required", deviceId }, 403);
      }
    }

    await next();
  };
};

/**
 * Guard that returns 401 if no valid session is present.
 * Must be used AFTER sessionMiddleware.
 */
export const requireSession = (): MiddlewareHandler => {
  return async (c, next) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }
    await next();
  };
};
