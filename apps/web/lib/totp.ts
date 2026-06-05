/**
 * TOTP (Time-based One-Time Password) generation per RFC 6238.
 * Uses WebCrypto HMAC-SHA1 for cryptographic operations.
 */

const TOTP_PERIOD = 30;
const TOTP_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode a base32 string to Uint8Array.
 * Handles padding and case-insensitive input.
 */
export const decodeBase32 = (input: string): Uint8Array => {
  const cleaned = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((value >>> bits) & 0xff);
    }
  }

  return new Uint8Array(output);
};

/**
 * Encode a Uint8Array to base32 string.
 */
export const encodeBase32 = (data: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return output;
};

/**
 * Parse an otpauth:// URI and extract the secret and parameters.
 */
export const parseOtpauthUri = (uri: string): {
  secret: string;
  issuer: string | undefined;
  account: string | undefined;
  period: number;
  digits: number;
  algorithm: string;
} => {
  const url = new URL(uri);
  if (url.protocol !== "otpauth:") throw new Error("Not an otpauth URI");
  if (url.hostname !== "totp") throw new Error("Only TOTP URIs are supported");

  const secret = url.searchParams.get("secret");
  if (!secret) throw new Error("Missing secret parameter");

  const issuer = url.searchParams.get("issuer") ?? undefined;
  const period = parseInt(url.searchParams.get("period") ?? "30", 10);
  const digits = parseInt(url.searchParams.get("digits") ?? "6", 10);
  const algorithm = url.searchParams.get("algorithm") ?? "SHA1";

  // Account is in the pathname: /issuer:account or /account
  const pathPart = url.pathname.replace(/^\//u, "");
  const colonIndex = pathPart.indexOf(":");
  const account = colonIndex >= 0 ? pathPart.slice(colonIndex + 1) : pathPart;

  return { secret, issuer, account: decodeURIComponent(account), period, digits, algorithm };
};

/**
 * Convert a time value to a counter (time step).
 */
const timeToCounter = (timeMs: number, period: number): bigint => {
  return BigInt(Math.floor(timeMs / 1000 / period));
};

/**
 * Generate TOTP code using WebCrypto HMAC-SHA1.
 *
 * @param secret Base32-encoded secret or otpauth:// URI
 * @param timeMs Current time in milliseconds (default: Date.now())
 * @param period Time step in seconds (default: 30)
 * @param digits Number of digits (default: 6)
 */
export const generateTotp = async (
  secret: string,
  timeMs?: number,
  period = TOTP_PERIOD,
  digits = TOTP_DIGITS
): Promise<{ code: string; remaining: number }> => {
  // If it's an otpauth URI, parse it
  let base32Secret = secret;
  if (secret.startsWith("otpauth://")) {
    const parsed = parseOtpauthUri(secret);
    base32Secret = parsed.secret;
    period = parsed.period;
    digits = parsed.digits;
  }

  const now = timeMs ?? Date.now();
  const counter = timeToCounter(now, period);
  const remaining = period - (Math.floor(now / 1000) % period);

  // Convert counter to 8-byte big-endian
  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(c & 0xffn);
    c >>= 8n;
  }

  // HMAC-SHA1
  const keyBytes = decodeBase32(base32Secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));

  // Dynamic truncation (RFC 4226 Section 5.4)
  const offset = signature[signature.length - 1]! & 0x0f;
  const binary =
    ((signature[offset]! & 0x7f) << 24) |
    ((signature[offset + 1]! & 0xff) << 16) |
    ((signature[offset + 2]! & 0xff) << 8) |
    (signature[offset + 3]! & 0xff);

  const otp = binary % 10 ** digits;
  const code = otp.toString().padStart(digits, "0");

  return { code, remaining };
};

/**
 * Validate that a string is a valid TOTP secret (base32 or otpauth URI).
 */
export const isValidTotpSecret = (input: string): boolean => {
  if (input.startsWith("otpauth://")) {
    try {
      parseOtpauthUri(input);
      return true;
    } catch {
      return false;
    }
  }
  // Check if it's valid base32
  try {
    const cleaned = input.replace(/[\s=-]/g, "").toUpperCase();
    if (cleaned.length < 16) return false; // Minimum 80 bits
    for (const char of cleaned) {
      if (!BASE32_ALPHABET.includes(char)) return false;
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Extract base32 secret from input (handles both raw base32 and otpauth URI).
 */
export const extractSecret = (input: string): string => {
  if (input.startsWith("otpauth://")) {
    return parseOtpauthUri(input).secret.replace(/[\s=-]/g, "").toUpperCase();
  }
  return input.replace(/[\s=-]/g, "").toUpperCase();
};
