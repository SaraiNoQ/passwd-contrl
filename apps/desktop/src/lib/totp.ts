const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function encodeText(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function decodeBase32(input: string): Uint8Array {
  const cleaned = input.replace(/[\s=-]/g, "").toUpperCase();
  if (cleaned.length === 0) {
    return new Uint8Array(0);
  }

  const bits: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) {
      throw new Error(`invalid_base32_character: ${char}`);
    }
    for (let i = 4; i >= 0; i--) {
      bits.push((index >> i) & 1);
    }
  }

  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    if (i + 8 > bits.length) break;
    let byte = 0;
    for (let j = 0; j < 8; j++) {
      byte = (byte << 1) | bits[i + j]!;
    }
    bytes.push(byte);
  }

  return new Uint8Array(bytes);
}

export function encodeBase32(data: Uint8Array): string {
  let bits = "";
  for (const byte of data) {
    bits += byte.toString(2).padStart(8, "0");
  }

  let output = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(chunk, 2)];
  }

  return output;
}

export function parseOtpauthUri(uri: string): {
  secret: string;
  issuer: string;
  account: string;
  period: number;
  digits: number;
  algorithm: string;
} {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:" || url.host !== "totp") {
    throw new Error("invalid_otpauth_uri");
  }

  const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
  let issuer = "";
  let account = path;
  const colonIndex = path.indexOf(":");
  if (colonIndex >= 0) {
    issuer = path.slice(0, colonIndex);
    account = path.slice(colonIndex + 1);
  }

  const params = url.searchParams;
  const secret = params.get("secret");
  if (!secret) {
    throw new Error("missing_otpauth_secret");
  }

  return {
    secret: secret.toUpperCase(),
    issuer: params.get("issuer") ?? issuer,
    account,
    period: Number(params.get("period") ?? TOTP_PERIOD),
    digits: Number(params.get("digits") ?? TOTP_DIGITS),
    algorithm: (params.get("algorithm") ?? "SHA1").toUpperCase(),
  };
}

function timeToCounter(timeMs: number, period: number): bigint {
  return BigInt(Math.floor(timeMs / 1000 / period));
}

function uint8ArrayToBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

export async function generateTotp(
  secret: string,
  timeMs: number = Date.now(),
  period: number = TOTP_PERIOD,
  digits: number = TOTP_DIGITS,
): Promise<{ code: string; remaining: number }> {
  let keyBytes: Uint8Array;
  if (secret.startsWith("otpauth://")) {
    const parsed = parseOtpauthUri(secret);
    keyBytes = decodeBase32(parsed.secret);
    period = parsed.period;
    digits = parsed.digits;
  } else {
    keyBytes = decodeBase32(secret);
  }

  let counter = timeToCounter(timeMs, period);
  const counterBytes = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(counter & 0xffn);
    counter >>= 8n;
  }

  const hmacKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", hmacKey, toArrayBuffer(counterBytes)),
  );

  const offset = sig[sig.length - 1]! & 0x0f;
  const truncated =
    ((sig[offset]! & 0x7f) << 24) |
    ((sig[offset + 1]! & 0xff) << 16) |
    ((sig[offset + 2]! & 0xff) << 8) |
    (sig[offset + 3]! & 0xff);
  const otp = truncated % 10 ** digits;
  const code = String(otp).padStart(digits, "0");

  const elapsed = Math.floor(timeMs / 1000) % period;
  const remaining = period - elapsed;

  return { code, remaining };
}

export function isValidTotpSecret(input: string): boolean {
  if (input.startsWith("otpauth://")) {
    try {
      parseOtpauthUri(input);
      return true;
    } catch {
      return false;
    }
  }
  const cleaned = input.replace(/[\s=-]/g, "").toUpperCase();
  if (cleaned.length < 16) return false;
  return [...cleaned].every((char) => BASE32_ALPHABET.includes(char));
}

export function extractSecret(input: string): string {
  if (input.startsWith("otpauth://")) {
    return parseOtpauthUri(input).secret;
  }
  return input.replace(/[\s=-]/g, "").toUpperCase();
}
