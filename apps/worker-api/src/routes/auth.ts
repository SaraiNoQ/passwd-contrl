import { Hono } from "hono";
import {
  registerStartRequestSchema,
  registerFinishRequestSchema,
  loginStartRequestSchema,
  loginFinishRequestSchema,
  type SessionUserResponse
} from "@zero-vault/shared";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { sessionMiddleware } from "../middleware/session";
import { rateLimit, createD1RateLimitStore } from "../middleware/rate-limit";
import { setCookie, clearCookie, SESSION_COOKIE_NAME } from "../utils/cookies";
import { generateToken, hashToken } from "../utils/crypto";
import { getOpaqueServer, type OpaqueServer } from "../opaque-loader";

// ── Constants ──────────────────────────────────────────────────────────────

const SESSION_DAYS = 14;
const OPAQUE_SESSION_MINUTES = 10;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;

const opaqueIdentifiers = (email: string) => ({
  client: email,
  server: "zero-vault"
});

let generatedOpaqueServerSetup: string | undefined;

export function resolveOpaqueServerSetup(env: Env, opaqueServer: Pick<OpaqueServer, "createSetup">): string {
  if (env.OPAQUE_SERVER_SETUP) {
    return env.OPAQUE_SERVER_SETUP;
  }
  if (!generatedOpaqueServerSetup) {
    generatedOpaqueServerSetup = opaqueServer.createSetup();
    console.log(
      "[OPAQUE] Generated new server setup. Add this to wrangler.toml [vars] to persist across restarts:\n" +
      `OPAQUE_SERVER_SETUP = "${generatedOpaqueServerSetup}"`
    );
  }
  return generatedOpaqueServerSetup;
}

export function resetGeneratedOpaqueServerSetupForTest(): void {
  generatedOpaqueServerSetup = undefined;
}

function opaqueExpiry(): Date {
  const date = new Date();
  date.setMinutes(date.getMinutes() + OPAQUE_SESSION_MINUTES);
  return date;
}

function sessionDaysFromNow(): Date {
  const date = new Date();
  date.setDate(date.getDate() + SESSION_DAYS);
  return date;
}

// ── Route Builder ──────────────────────────────────────────────────────────

export function buildAuthRoutes(): Hono<{ Bindings: Env }> {
  const auth = new Hono<{ Bindings: Env }>();

  // D1-backed rate limit store — created once per isolate lifetime.
  // The rate limit middleware reads it from Hono context variables.
  let d1RateLimitStore: ReturnType<typeof createD1RateLimitStore> | undefined;
  auth.use("*", async (c, next) => {
    if (!d1RateLimitStore && c.env.DB) {
      d1RateLimitStore = createD1RateLimitStore(c.env.DB);
    }
    c.set("rateLimitStore", d1RateLimitStore);
    await next();
  });

  auth.use("*", sessionMiddleware());

  // ── POST /auth/register/start ────────────────────────────────────────────

  auth.post("/auth/register/start", rateLimit({ max: 60 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_register_start_request" }, 400);
    }

    const parsed = registerStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_register_start_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    const existing = await store.findUserByEmail(parsed.data.email);
    if (existing) {
      return c.json({ error: "user_exists" }, 409);
    }

    let opaqueServer: OpaqueServer;
    try {
      opaqueServer = await getOpaqueServer();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "opaque_unavailable" },
        503
      );
    }

    const serverSetup = resolveOpaqueServerSetup(c.env, opaqueServer);

    const registration = opaqueServer.createRegistrationResponse({
      serverSetup,
      userIdentifier: parsed.data.email,
      registrationRequest: parsed.data.registrationRequest
    });

    const session = await store.createRegistrationSession({
      email: parsed.data.email,
      registrationResponse: registration.registrationResponse,
      expiresAt: opaqueExpiry()
    });

    return c.json({
      registrationSessionId: session.id,
      registrationResponse: registration.registrationResponse
    });
  });

  // ── POST /auth/register/finish ───────────────────────────────────────────

  auth.post("/auth/register/finish", rateLimit({ max: 60 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_register_finish_request" }, 400);
    }

    const parsed = registerFinishRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_register_finish_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    const session = await store.consumeRegistrationSession(parsed.data.registrationSessionId);
    if (!session || session.email !== parsed.data.email) {
      return c.json({ error: "invalid_registration_session" }, 400);
    }

    if (session.expiresAt < new Date()) {
      return c.json({ error: "invalid_registration_session" }, 400);
    }

    const existing = await store.findUserByEmail(parsed.data.email);
    if (existing) {
      return c.json({ error: "user_exists" }, 409);
    }

    try {
      const user = await store.createUser({
        email: parsed.data.email,
        opaqueRegistrationRecord: parsed.data.registrationRecord,
        publicKeyBundle: parsed.data.publicKeyBundle,
        encryptedRecoveryPacket: parsed.data.encryptedRecoveryPacket
      });
      return c.json({ userId: user.id }, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "user_exists") {
        return c.json({ error: "user_exists" }, 409);
      }
      throw error;
    }
  });

  // ── POST /auth/login/start ───────────────────────────────────────────────

  auth.post("/auth/login/start", rateLimit({ max: 60 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_login_start_request" }, 400);
    }

    const parsed = loginStartRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_login_start_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    const user = await store.findUserByEmail(parsed.data.email);
    if (!user) {
      return c.json({ error: "user_not_found" }, 404);
    }

    let opaqueServer: OpaqueServer;
    try {
      opaqueServer = await getOpaqueServer();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "opaque_unavailable" },
        503
      );
    }

    const serverSetup = resolveOpaqueServerSetup(c.env, opaqueServer);

    const login = opaqueServer.startLogin({
      serverSetup,
      registrationRecord: user.opaqueRegistrationRecord,
      startLoginRequest: parsed.data.startLoginRequest,
      userIdentifier: user.email,
      identifiers: opaqueIdentifiers(user.email)
    });

    const loginSession = await store.createLoginSession({
      userId: user.id,
      serverLoginState: login.serverLoginState,
      expiresAt: opaqueExpiry()
    });

    return c.json({
      loginSessionId: loginSession.id,
      loginResponse: login.loginResponse
    });
  });

  // ── POST /auth/login/finish ──────────────────────────────────────────────

  auth.post("/auth/login/finish", rateLimit({ max: 60 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_login_finish_request" }, 400);
    }

    const parsed = loginFinishRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_login_finish_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    const loginSession = await store.consumeLoginSession(parsed.data.loginSessionId);
    if (!loginSession) {
      return c.json({ error: "invalid_login_session" }, 400);
    }

    if (loginSession.expiresAt < new Date()) {
      return c.json({ error: "invalid_login_session" }, 400);
    }

    const user = await store.findUserById(loginSession.userId);
    if (!user) {
      return c.json({ error: "user_not_found" }, 404);
    }

    let opaqueServer: OpaqueServer;
    try {
      opaqueServer = await getOpaqueServer();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "opaque_unavailable" },
        503
      );
    }

    try {
      opaqueServer.finishLogin({
        serverLoginState: loginSession.serverLoginState,
        finishLoginRequest: parsed.data.finishLoginRequest,
        identifiers: opaqueIdentifiers(user.email)
      });
    } catch {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const token = generateToken();
    const csrfToken = generateToken();
    const tokenHashValue = await hashToken(token);

    await store.createSession({
      userId: user.id,
      tokenHash: tokenHashValue,
      csrfToken,
      expiresAt: sessionDaysFromNow()
    });

    const response: SessionUserResponse = {
      user: {
        id: user.id,
        email: user.email,
        serverRevision: user.serverRevision
      },
      csrfToken
    };

    const isDev = c.env.ENVIRONMENT === "development";
    const res = c.json(response);
    res.headers.set(
      "Set-Cookie",
      setCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? "Lax" : "None",
        path: "/",
        maxAge: SESSION_MAX_AGE
      })
    );

    return res;
  });

  // ── POST /auth/login/direct ──────────────────────────────────────────────
  // Development-only escape hatch. This endpoint does not verify a password and
  // must never be reachable unless explicitly enabled for local test tooling.

  auth.post("/auth/login/direct", rateLimit({ max: 60 }), async (c) => {
    const directLoginEnabled =
      c.env.ALLOW_INSECURE_DIRECT_LOGIN === "true" &&
      (c.env.ENVIRONMENT === "development" || c.env.ENVIRONMENT === "test");
    if (!directLoginEnabled) {
      return c.json({ error: "not_found" }, 404);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request" }, 400);
    }

    const { email, password } = body as { email?: string; password?: string };
    if (!email || !password) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    const store = new D1VaultStore(c.env.DB);

    let user = await store.findUserByEmail(email);

    if (!user) {
      // Auto-create user for MVP demo login.
      // Placeholder OPAQUE fields — these would be populated by real registration
      // when the OPAQUE flow is available on all platforms.
      user = await store.createUser({
        email,
        opaqueRegistrationRecord: "__mvp_direct_login__",
        publicKeyBundle: "__mvp_placeholder__",
        encryptedRecoveryPacket: {
          alg: "XCHACHA20_POLY1305" as const,
          nonce: "__mvp_placeholder__",
          ciphertext: "__mvp_placeholder__",
        },
      });
    }

    const token = generateToken();
    const csrfToken = generateToken();
    const tokenHashValue = await hashToken(token);

    await store.createSession({
      userId: user.id,
      tokenHash: tokenHashValue,
      csrfToken,
      expiresAt: sessionDaysFromNow(),
    });

    const response: SessionUserResponse = {
      user: {
        id: user.id,
        email: user.email,
        serverRevision: user.serverRevision,
      },
      csrfToken,
    };

    const isDev = c.env.ENVIRONMENT === "development";
    const res = c.json(response);
    res.headers.set(
      "Set-Cookie",
      setCookie(SESSION_COOKIE_NAME, token, {
        httpOnly: true,
        secure: !isDev,
        sameSite: isDev ? "Lax" : "None",
        path: "/",
        maxAge: SESSION_MAX_AGE
      })
    );

    return res;
  });

  // ── GET /auth/me ─────────────────────────────────────────────────────────

  auth.get("/auth/me", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const response: SessionUserResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        serverRevision: session.user.serverRevision
      },
      csrfToken: session.csrfToken
    };

    return c.json(response);
  });

  // Also support /auth/session for backward compatibility
  auth.get("/auth/session", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const response: SessionUserResponse = {
      user: {
        id: session.user.id,
        email: session.user.email,
        serverRevision: session.user.serverRevision
      },
      csrfToken: session.csrfToken
    };

    return c.json(response);
  });

  // ── POST /auth/logout ────────────────────────────────────────────────────

  auth.post("/auth/logout", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const csrfHeader = c.req.header("x-zero-vault-csrf");
    if (!csrfHeader || csrfHeader !== session.csrfToken) {
      return c.json({ error: "csrf_token_required" }, 403);
    }

    const store = new D1VaultStore(c.env.DB);
    const isDev = c.env.ENVIRONMENT === "development";
    await store.deleteSession(session.tokenHash);

    const res = c.json({ ok: true });
    res.headers.set("Set-Cookie", clearCookie(SESSION_COOKIE_NAME, "/", isDev ? "Lax" : "None"));
    return res;
  });

  // ── DELETE /auth/account ──────────────────────────────────────────────────

  auth.delete("/auth/account", async (c) => {
    const session = c.get("session");
    if (!session) {
      return c.json({ error: "not_authenticated" }, 401);
    }

    const csrfHeader = c.req.header("x-zero-vault-csrf");
    if (!csrfHeader || csrfHeader !== session.csrfToken) {
      return c.json({ error: "csrf_token_required" }, 403);
    }

    const store = new D1VaultStore(c.env.DB);
    const isDev = c.env.ENVIRONMENT === "development";
    await store.deleteUser(session.userId);

    const res = c.json({ ok: true });
    res.headers.set("Set-Cookie", clearCookie(SESSION_COOKIE_NAME, "/", isDev ? "Lax" : "None"));
    return res;
  });

  return auth;
}
