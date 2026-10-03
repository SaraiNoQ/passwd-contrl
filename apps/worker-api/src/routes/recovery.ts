import { Hono } from "hono";
import type { Env } from "../env";
import { D1VaultStore } from "../store";
import {
  buildRecoveryFinishTranscript,
  decodeCanonicalBase64Url,
  encodeCanonicalBase64Url,
  recoveryFinishRequestSchema,
  recoveryFinishResponseSchema,
  recoveryPacketResponseSchema,
  recoveryStartRequestSchema,
  recoveryStartResponseSchema,
  recoveryV1MigrationRequestSchema,
  recoveryV2RotationRequestSchema,
  type RecoveryFinishUnsignedRequest,
  type RecoveryPacketV2
} from "@zero-vault/shared";
import { createD1RateLimitStore, rateLimit } from "../middleware/rate-limit";
import { getOpaqueServer, type OpaqueServer } from "../opaque-loader";
import { resolveOpaqueServerSetup } from "./auth";
import { hashToken } from "../utils/crypto";

const RECOVERY_CHALLENGE_MINUTES = 10;
const DUMMY_ED25519_PUBLIC_KEY = Uint8Array.from([
  0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7,
  0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
  0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25,
  0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a
]);
const DUMMY_RECOVERY_MATERIAL_BYTES = 16 + 24 + 81 + 32;
const DUMMY_RECOVERY_DOMAIN = new TextEncoder().encode(
  "zero-vault/recovery-dummy/v1\0"
);

const randomBase64Url = (bytes: number): string => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return encodeCanonicalBase64Url(value);
};

const challengeExpiry = (): Date =>
  new Date(Date.now() + RECOVERY_CHALLENGE_MINUTES * 60_000);

const asArrayBuffer = (value: Uint8Array): ArrayBuffer => Uint8Array.from(value).buffer;

const deriveDummyRecoveryMaterial = async (
  serverSetup: string,
  normalizedEmail: string
): Promise<{ packet: RecoveryPacketV2; signingPublicKey: string }> => {
  const encoder = new TextEncoder();
  const email = encoder.encode(normalizedEmail);
  const key = await crypto.subtle.importKey(
    "raw",
    asArrayBuffer(encoder.encode(serverSetup)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const material = new Uint8Array(DUMMY_RECOVERY_MATERIAL_BYTES);
  let materialOffset = 0;
  for (let counter = 1; materialOffset < material.length; counter += 1) {
    const input = new Uint8Array(DUMMY_RECOVERY_DOMAIN.length + 4 + email.length + 4);
    input.set(DUMMY_RECOVERY_DOMAIN, 0);
    const view = new DataView(input.buffer);
    view.setUint32(DUMMY_RECOVERY_DOMAIN.length, email.length, false);
    input.set(email, DUMMY_RECOVERY_DOMAIN.length + 4);
    view.setUint32(DUMMY_RECOVERY_DOMAIN.length + 4 + email.length, counter, false);
    const block = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, asArrayBuffer(input))
    );
    const remaining = material.length - materialOffset;
    material.set(block.subarray(0, Math.min(block.length, remaining)), materialOffset);
    materialOffset += Math.min(block.length, remaining);
  }

  return {
    packet: {
      version: 2,
      alg: "XCHACHA20_POLY1305",
      kdf: {
        alg: "ARGON2ID_V13",
        salt: encodeCanonicalBase64Url(material.subarray(0, 16)),
        memoryKib: 65_536,
        iterations: 3,
        parallelism: 4
      },
      nonce: encodeCanonicalBase64Url(material.subarray(16, 40)),
      ciphertext: encodeCanonicalBase64Url(material.subarray(40, 121))
    },
    signingPublicKey: encodeCanonicalBase64Url(material.subarray(121, 153))
  };
};

const verifyEd25519 = async (
  publicKey: Uint8Array,
  signature: Uint8Array,
  message: Uint8Array
): Promise<boolean> => {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      asArrayBuffer(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      asArrayBuffer(signature),
      asArrayBuffer(message)
    );
  } catch {
    return false;
  }
};

const loadOpaque = async (c: { env: Env }): Promise<{
  opaqueServer: OpaqueServer;
  serverSetup: string;
} | null> => {
  try {
    const opaqueServer = await getOpaqueServer();
    return {
      opaqueServer,
      serverSetup: resolveOpaqueServerSetup(c.env, opaqueServer)
    };
  } catch {
    return null;
  }
};

export function buildRecoveryRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  let recoveryRateLimitStore: ReturnType<typeof createD1RateLimitStore> | undefined;
  app.use("*", async (c, next) => {
    recoveryRateLimitStore ??= createD1RateLimitStore(c.env.DB);
    c.set("rateLimitStore", recoveryRateLimitStore);
    await next();
  });

  // ── POST /auth/recovery/start ────────────────────────────────────────────
  app.post("/auth/recovery/start", rateLimit({ max: 10 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_recovery_start_request" }, 400);
    }
    const parsed = recoveryStartRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_recovery_start_request" }, 400);

    const opaque = await loadOpaque(c);
    if (!opaque) return c.json({ error: "opaque_unavailable" }, 503);

    // This derivation is deliberately unconditional. Known-v2, legacy-v1 and
    // unknown accounts all pay the same HMAC expansion cost; only after it is
    // complete do we select real or deterministic fake recovery material.
    let fakeMaterial: Awaited<ReturnType<typeof deriveDummyRecoveryMaterial>>;
    try {
      fakeMaterial = await deriveDummyRecoveryMaterial(
        opaque.serverSetup,
        parsed.data.email
      );
    } catch {
      return c.json({ error: "opaque_unavailable" }, 503);
    }

    let registration: ReturnType<OpaqueServer["createRegistrationResponse"]>;
    try {
      registration = opaque.opaqueServer.createRegistrationResponse({
        serverSetup: opaque.serverSetup,
        userIdentifier: parsed.data.email,
        registrationRequest: parsed.data.registrationRequest
      });
    } catch {
      return c.json({ error: "invalid_recovery_start_request" }, 400);
    }

    const store = new D1VaultStore(c.env.DB);
    const registrationSession = await store.createRegistrationSession({
      email: parsed.data.email,
      registrationResponse: registration.registrationResponse,
      expiresAt: challengeExpiry()
    });
    const user = await store.findUserByRecoveryEmail(parsed.data.email);
    // Always execute the recovery-record lookup, including for an unknown
    // account, to keep the D1 work and response shape close.
    const record = await store.getRecoveryRecord(user?.id ?? crypto.randomUUID());
    const knownV2 = Boolean(
      user && record?.protocolVersion === 2 && record.signingPublicKey
    );
    const challenge = randomBase64Url(32);
    const attempt = await store.createRecoveryChallenge({
      userId: knownV2 ? user!.id : null,
      authEpoch: knownV2 ? user!.authEpoch : null,
      recoveryGeneration: knownV2 ? record!.generation : null,
      nonce: challenge,
      registrationSessionId: registrationSession.id,
      expiresAt: challengeExpiry()
    });

    return c.json(recoveryStartResponseSchema.parse({
      recoveryAttemptId: attempt.id,
      challenge,
      registrationSessionId: registrationSession.id,
      registrationResponse: registration.registrationResponse,
      encryptedRecoveryPacket: knownV2
        ? record!.encryptedRecoveryPacket
        : fakeMaterial.packet,
      recoverySigningPublicKey: knownV2
        ? record!.signingPublicKey
        : fakeMaterial.signingPublicKey
    }));
  });

  // ── POST /auth/recovery/finish ───────────────────────────────────────────
  app.post("/auth/recovery/finish", rateLimit({ max: 10 }), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_recovery_finish_request" }, 400);
    }
    const parsed = recoveryFinishRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_recovery_finish_request" }, 400);
    const { signature, ...request } = parsed.data;
    const unsigned: RecoveryFinishUnsignedRequest = request;

    const store = new D1VaultStore(c.env.DB);
    const challenge = await store.getRecoveryChallenge(unsigned.recoveryAttemptId);
    const user = challenge?.userId
      ? await store.findUserById(challenge.userId)
      : null;
    const record = user ? await store.getRecoveryRecord(user.id) : null;
    const registration = await store.getRegistrationSession(unsigned.registrationSessionId);

    const transcript = buildRecoveryFinishTranscript({
      ...unsigned,
      challenge: challenge?.nonce ?? randomBase64Url(32)
    });
    const candidatePublicKey =
      record?.protocolVersion === 2 && record.signingPublicKey
        ? decodeCanonicalBase64Url(record.signingPublicKey)
        : DUMMY_ED25519_PUBLIC_KEY;
    // Unknown/v1 attempts still perform one real Ed25519 verification with a
    // valid dummy public key before returning the unified authorization error.
    const signatureValid = await verifyEd25519(
      candidatePublicKey,
      decodeCanonicalBase64Url(signature),
      transcript
    );

    const authorized = Boolean(
      signatureValid &&
      challenge && challenge.userId && challenge.expiresAt > new Date() &&
      challenge.registrationSessionId === unsigned.registrationSessionId &&
      user && user.email.trim().toLowerCase() === unsigned.email &&
      challenge.authEpoch === user.authEpoch &&
      record?.protocolVersion === 2 && record.signingPublicKey &&
      challenge.recoveryGeneration === record.generation &&
      registration && registration.email.trim().toLowerCase() === unsigned.email
    );
    if (!authorized || !challenge || !user) {
      return c.json({ error: "invalid_recovery_authorization" }, 401);
    }

    const owner = await store.getDeviceOwnerUserId(unsigned.device.id);
    if (owner && owner !== user.id) return c.json({ error: "device_id_conflict" }, 409);

    try {
      await store.finishRecoveryV2({
        user,
        challenge,
        request: unsigned,
        deviceCredentialHash: await hashToken(unsigned.device.credential)
      });
    } catch (error) {
      if (error instanceof Error && error.message === "device_id_conflict") {
        return c.json({ error: "device_id_conflict" }, 409);
      }
      if (error instanceof Error && error.message === "invalid_recovery_authorization") {
        return c.json({ error: "invalid_recovery_authorization" }, 401);
      }
      throw error;
    }
    return c.json(recoveryFinishResponseSchema.parse({ ok: true }));
  });

  // The legacy unauthenticated packet lookup is intentionally gone. A v1
  // account must log in and migrate; v1 and unknown recovery starts are both
  // represented by dummy v2 material above.

  // ── GET /vault/recovery-packet (authenticated v1 migration read) ────────
  app.get("/vault/recovery-packet", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    const store = new D1VaultStore(c.env.DB);
    const record = await store.getRecoveryRecord(session.userId);
    if (!record) return c.json({ error: "recovery_packet_not_found" }, 404);
    if (record.protocolVersion === 2) {
      return c.json({ error: "recovery_v2_managed" }, 409);
    }
    return c.json(recoveryPacketResponseSchema.parse({
      encryptedRecoveryPacket: record.encryptedRecoveryPacket
    }));
  });

  // ── POST /vault/recovery-packet (one-time v1 -> v2 migration) ───────────
  app.post("/vault/recovery-packet", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_recovery_packet_request" }, 400);
    }
    const parsed = recoveryV1MigrationRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_recovery_packet_request" }, 400);

    const store = new D1VaultStore(c.env.DB);
    const record = await store.getRecoveryRecord(session.userId);
    if (record?.protocolVersion === 2) {
      return c.json({ error: "recovery_v2_rotation_required" }, 409);
    }
    await store.migrateRecoveryV1(
      session.userId,
      parsed.data.encryptedRecoveryPacket,
      parsed.data.recoverySigningPublicKey
    );
    return c.json({ ok: true });
  });

  // ── POST /vault/recovery/rotate (authenticated v2 rotation) ─────────────
  app.post("/vault/recovery/rotate", async (c) => {
    const session = c.get("session");
    if (!session) return c.json({ error: "not_authenticated" }, 401);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_recovery_rotation_request" }, 400);
    }
    const parsed = recoveryV2RotationRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: "invalid_recovery_rotation_request" }, 400);

    const store = new D1VaultStore(c.env.DB);
    const user = await store.findUserById(session.userId);
    const record = await store.getRecoveryRecord(session.userId);
    if (!user || record?.protocolVersion !== 2) {
      return c.json({ error: "recovery_v2_required" }, 409);
    }
    try {
      await store.rotateRecoveryV2(
        user,
        record.generation,
        parsed.data.encryptedRecoveryPacket,
        parsed.data.recoverySigningPublicKey
      );
    } catch (error) {
      if (error instanceof Error && error.message === "recovery_state_changed") {
        return c.json({ error: "recovery_state_changed" }, 409);
      }
      throw error;
    }
    return c.json({ ok: true });
  });

  return app;
}
