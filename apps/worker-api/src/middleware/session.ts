/**
 * Session middleware for Hono.
 *
 * Reads the session token from the cookie, looks it up in D1 by token hash,
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
}

/** Full session context attached to Hono's c.set(). */
export interface SessionData {
  userId: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
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
    const cookieHeader = c.req.header("cookie") ?? "";
    const cookies = parseCookies(cookieHeader);
    const token = cookies[SESSION_COOKIE_NAME];

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
      `SELECT s.user_id, s.csrf_token, s.expires_at,
              u.id as uid, u.email, u.server_revision,
              u.opaque_registration_record, u.public_key_bundle
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    );
    const row = (await stmt.bind(tokenHash).first()) as {
      user_id: string;
      csrf_token: string;
      expires_at: string;
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

    const sessionData: SessionData = {
      userId: row.user_id,
      tokenHash,
      csrfToken: row.csrf_token,
      expiresAt: row.expires_at,
      user: {
        id: row.uid,
        email: row.email,
        serverRevision: row.server_revision,
        opaqueRegistrationRecord: row.opaque_registration_record,
        publicKeyBundle: row.public_key_bundle
      }
    };

    c.set("session", sessionData);
    c.set("csrfToken", row.csrf_token);
    c.set("userId", row.user_id);

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
