import { Hono, type Context } from "hono";
import {
  registerStartRequestSchema,
  registerFinishRequestSchema,
  mobileRegisterFinishRequestSchema,
  loginStartRequestSchema,
  loginFinishRequestSchema,
  mobileLoginFinishRequestSchema,
  type MobileSessionResponse,
  type SessionUserResponse
} from "@zero-vault/shared";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import { sessionMiddleware } from "../middleware/session";
import { rateLimit, createD1RateLimitStore } from "../middleware/rate-limit";
import { setCookie, clearCookie, SESSION_COOKIE_NAME } from "../utils/cookies";
import { generateToken, hashToken, publicKeyFingerprint } from "../utils/crypto";
import { getOpaqueServer, type OpaqueServer } from "../opaque-loader";
import { R2Storage } from "../storage/r2-helpers";

// ── Constants ──────────────────────────────────────────────────────────────

const SESSION_DAYS = 14;
const OPAQUE_SESSION_MINUTES = 10;
const SESSION_MAX_AGE = SESSION_DAYS * 24 * 60 * 60;
const ACCOUNT_DELETE_AUTH_MAX_AGE_MS = 5 * 60 * 1000;

const opaqueIdentifiers = (email: string) => ({
  client: email,
  server: "zero-vault"
});

let generatedOpaqueServerSetup: string | undefined;

export function resolveOpaqueServerSetup(env: Env, opaqueServer: Pick<OpaqueServer, "createSetup">): string {
  if (env.OPAQUE_SERVER_SETUP?.trim()) {
    return env.OPAQUE_SERVER_SETUP;
  }
  const environment = env.ENVIRONMENT?.trim().toLowerCase();
  if (environment === "production" || environment === "staging") {
    throw new Error("opaque_server_setup_required");
  }
  if (!generatedOpaqueServerSetup) {
    generatedOpaqueServerSetup = opaqueServer.createSetup();
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

    let serverSetup: string;
    try {
      serverSetup = resolveOpaqueServerSetup(c.env, opaqueServer);
    } catch {
      return c.json({ error: "opaque_unavailable" }, 503);
    }

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

  // ── POST /auth/mobile/register/finish ────────────────────────────────────
  // The first mobile device is bootstrapped in the same D1 batch as the user,
  // its encrypted vault-key packet and its device-bound bearer session.
  auth.post("/auth/mobile/register/finish", rateLimit({ max: 60 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_register_finish_request" }, 400);
    }
    const parsed = mobileRegisterFinishRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_register_finish_request" }, 400);

    const store = new D1VaultStore(c.env.DB);
    const registrationSession = await store.consumeRegistrationSession(
      parsed.data.registrationSessionId
    );
    if (!registrationSession || registrationSession.email !== parsed.data.email) {
      return c.json({ error: "invalid_registration_session" }, 400);
    }
    if (registrationSession.expiresAt < new Date()) {
      return c.json({ error: "invalid_registration_session" }, 400);
    }
    if (await store.findUserByEmail(parsed.data.email)) {
      return c.json({ error: "user_exists" }, 409);
    }

    const sessionToken = generateToken();
    const csrfToken = generateToken();
    const now = new Date().toISOString();
    try {
      const { user } = await store.createMobileAccount({
        email: parsed.data.email,
        opaqueRegistrationRecord: parsed.data.registrationRecord,
        publicKeyBundle: parsed.data.publicKeyBundle,
        encryptedRecoveryPacket: parsed.data.encryptedRecoveryPacket,
        recoverySigningPublicKey: parsed.data.recoverySigningPublicKey,
        device: {
          id: parsed.data.device.id,
          name: parsed.data.device.name,
          fingerprint: parsed.data.device.fingerprint,
          publicKey: parsed.data.device.publicKey,
          status: "approved",
          createdAt: now,
          updatedAt: now,
          lastSeenIp: c.req.header("cf-connecting-ip") ?? null,
          lastSeenLocation: c.req.header("cf-ipcountry") ?? null
        },
        deviceCredentialHash: await hashToken(parsed.data.device.credential),
        encryptedVaultKeyPacket: parsed.data.device.encryptedVaultKeyPacket,
        session: {
          tokenHash: await hashToken(sessionToken),
          csrfToken,
          expiresAt: sessionDaysFromNow()
        }
      });
      const response: MobileSessionResponse = {
        user: {
          id: user.id,
          email: user.email,
          serverRevision: user.serverRevision
        },
        csrfToken,
        sessionToken,
        device: { id: parsed.data.device.id, status: "approved" }
      };
      return c.json(response, 201);
    } catch (error) {
      if (error instanceof Error && error.message === "user_exists") {
        return c.json({ error: "user_exists" }, 409);
      }
      if (error instanceof Error && error.message === "device_id_conflict") {
        return c.json({ error: "device_id_conflict" }, 409);
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
    const normalizedEmail = parsed.data.email.toLowerCase();
    const user = await store.findUserByEmail(parsed.data.email);

    let opaqueServer: OpaqueServer;
    try {
      opaqueServer = await getOpaqueServer();
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "opaque_unavailable" },
        503
      );
    }

    let serverSetup: string;
    try {
      serverSetup = resolveOpaqueServerSetup(c.env, opaqueServer);
    } catch {
      return c.json({ error: "opaque_unavailable" }, 503);
    }

    const login = opaqueServer.startLogin({
      serverSetup,
      registrationRecord: user?.opaqueRegistrationRecord ?? null,
      startLoginRequest: parsed.data.startLoginRequest,
      userIdentifier: user?.email ?? normalizedEmail,
      identifiers: opaqueIdentifiers(user?.email ?? normalizedEmail)
    });

    let loginSession;
    try {
      loginSession = user
        ? await store.createLoginSession({
            userId: user.id,
            serverLoginState: login.serverLoginState,
            authEpoch: user.authEpoch,
            expiresAt: opaqueExpiry()
          })
        : await store.createFakeLoginSession({
            email: normalizedEmail,
            serverLoginState: login.serverLoginState,
            expiresAt: opaqueExpiry()
          });
    } catch (error) {
      if (error instanceof Error && error.message === "auth_epoch_changed") {
        return c.json({ error: "invalid_login_session" }, 400);
      }
      throw error;
    }

    return c.json({
      loginSessionId: loginSession.id,
      loginResponse: login.loginResponse
    });
  });

  const finishLogin = async (
    c: Context<{ Bindings: Env }>,
    mobile: boolean,
    webDevice = false
  ): Promise<Response> => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_login_finish_request" }, 400);
    }

    const parsed = (mobile ? mobileLoginFinishRequestSchema : loginFinishRequestSchema).safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "invalid_login_finish_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);

    const loginSession = await store.consumeLoginSession(parsed.data.loginSessionId);
    const fakeLoginSession = loginSession
      ? null
      : await store.consumeFakeLoginSession(parsed.data.loginSessionId);
    if (!loginSession && !fakeLoginSession) {
      return c.json({ error: "invalid_login_session" }, 400);
    }

    if (loginSession && loginSession.expiresAt < new Date()) {
      return c.json({ error: "invalid_login_session" }, 400);
    }

    const user = loginSession ? await store.findUserById(loginSession.userId) : null;
    if (loginSession && !user) {
      return c.json({ error: "invalid_credentials" }, 401);
    }
    if (loginSession && user && loginSession.authEpoch !== user.authEpoch) {
      return c.json({ error: "invalid_login_session" }, 400);
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

    let opaqueVerified = true;
    try {
      opaqueServer.finishLogin({
        serverLoginState: (loginSession ?? fakeLoginSession)!.serverLoginState,
        finishLoginRequest: parsed.data.finishLoginRequest,
        identifiers: opaqueIdentifiers(user?.email ?? fakeLoginSession!.email)
      });
    } catch {
      opaqueVerified = false;
    }
    if (!opaqueVerified || fakeLoginSession || !user) {
      return c.json({ error: "invalid_credentials" }, 401);
    }

    let device: { id: string; status: "pending" | "approved" } | undefined;
    if (mobile) {
      const mobileRequest = mobileLoginFinishRequestSchema.parse(body);
      const input = mobileRequest.device;
      if (c.req.path === '/auth/extension/login/finish') {
        let fingerprint: string;
        try { fingerprint = await publicKeyFingerprint(input.publicKey); }
        catch { return c.json({ error: 'invalid_device_fingerprint' }, 400); }
        if (input.fingerprint !== fingerprint) return c.json({ error: 'invalid_device_fingerprint' }, 400);
      }
      const knownDevice = await store.getDevice(user.id, input.id);
      if (knownDevice) {
        const authenticatedDevice = await store.authenticateDevice({
          userId: user.id,
          deviceId: input.id,
          credentialHash: await hashToken(input.credential),
          fingerprint: input.fingerprint,
          publicKey: input.publicKey
        });
        if (!authenticatedDevice) {
          return c.json({ error: "invalid_device_credential" }, 401);
        }
        if (authenticatedDevice.status !== "pending" && authenticatedDevice.status !== "approved") {
          return c.json({ error: "device_not_trusted" }, 403);
        }
        device = { id: authenticatedDevice.id, status: authenticatedDevice.status };
      } else {
        const now = new Date().toISOString();
        let registeredDevice;
        try {
          registeredDevice = await store.registerDevice(
            user.id,
            {
              id: input.id,
              name: input.name,
              fingerprint: input.fingerprint,
              publicKey: input.publicKey,
              status: "pending",
              createdAt: now,
              updatedAt: now,
              lastSeenIp: c.req.header("cf-connecting-ip") ?? null,
              lastSeenLocation: c.req.header("cf-ipcountry") ?? null
            },
            await hashToken(input.credential),
            user.authEpoch
          );
        } catch (error) {
          // Do not disclose whether a caller-supplied UUID belongs to another
          // account. It is simply not a valid credential for this login.
          if (error instanceof Error && error.message === "device_id_conflict") {
            return c.json({ error: "invalid_device_credential" }, 401);
          }
          if (error instanceof Error && error.message === "auth_epoch_changed") {
            return c.json({ error: "invalid_login_session" }, 400);
          }
          throw error;
        }
        device = { id: registeredDevice.id, status: "pending" };
      }
    }

    const token = generateToken();
    const csrfToken = generateToken();
    const tokenHashValue = await hashToken(token);

    const sessionInput = {
      userId: user.id,
      tokenHash: tokenHashValue,
      csrfToken,
      authEpoch: user.authEpoch,
      expiresAt: sessionDaysFromNow()
    };
    try {
      if (mobile) {
        if (!device) throw new Error("mobile_device_required");
        await store.rotateDeviceSession({ ...sessionInput, deviceId: device.id });
      } else {
        await store.createSession(sessionInput);
      }
    } catch (error) {
      if (error instanceof Error && error.message === "auth_epoch_changed") {
        return c.json({ error: "invalid_login_session" }, 400);
      }
      throw error;
    }

    const response: SessionUserResponse = {
      user: {
        id: user.id,
        email: user.email,
        serverRevision: user.serverRevision
      },
      csrfToken
    };

    if (mobile && !webDevice) {
      if (!device) throw new Error("mobile_device_required");
      const mobileResponse: MobileSessionResponse = {
        ...response,
        sessionToken: token,
        device
      };
      return c.json(mobileResponse);
    }

    const isDev = c.env.ENVIRONMENT === "development";
    const res = c.json({ ...response, ...(device ? { device } : {}) });
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
  };

  // Web keeps the HttpOnly cookie flow. Android receives the same session as
  // a bearer token because native clients do not have a browser cookie jar.
  auth.post("/auth/login/finish", rateLimit({ max: 60 }), (c) => finishLogin(c, false));
  auth.post("/auth/mobile/login/finish", rateLimit({ max: 60 }), (c) => finishLogin(c, true));
  auth.post("/auth/extension/login/finish", rateLimit({ max: 60 }), (c) => finishLogin(c, true));
  auth.post("/auth/web/login/finish", rateLimit({ max: 60 }), (c) => finishLogin(c, true, true));

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
          // Syntactically valid legacy envelope only. The endpoint itself is
          // hard-disabled outside explicit development/test environments and
          // is never used by the Android client or recovery-v2 registration.
          nonce: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          ciphertext: "AAAAAAAAAAAAAAAAAAAAAA",
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
      authEpoch: user.authEpoch,
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

    return c.json({ ...response, ...(session.deviceId ? { device: { id: session.deviceId, status: session.deviceStatus } } : {}) });
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

    const authenticatedAt = new Date(session.createdAt).getTime();
    const authenticationAge = Date.now() - authenticatedAt;
    // Session creation happens only after the Worker completes OPAQUE login
    // (or the initial mobile registration transaction), so its server-written
    // timestamp is the recent-authentication proof for both cookie and bearer
    // clients. Never trust a client-supplied timestamp for this destructive
    // operation. Native bearer sessions additionally require an approved
    // device.
    if (
      !Number.isFinite(authenticatedAt) ||
      authenticationAge < 0 ||
      authenticationAge > ACCOUNT_DELETE_AUTH_MAX_AGE_MS ||
      (session.authTransport === "bearer" && session.deviceStatus !== "approved")
    ) {
      return c.json({ error: "recent_authentication_required" }, 403);
    }

    // R2 cannot participate in the D1 transaction. Delete remote ciphertext
    // first and keep the account/session intact on any failure so the operation
    // is safely retryable instead of leaving inaccessible orphaned backups.
    if (!c.env.R2) return c.json({ error: "account_deletion_storage_unavailable" }, 503);
    try {
      await new R2Storage(c.env.R2).deleteAccountObjects(session.userId);
    } catch {
      return c.json({ error: "account_deletion_incomplete" }, 503);
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
