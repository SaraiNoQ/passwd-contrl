/**
 * TOTP generation for the extension popup.
 * Simplified version of the web vault's totp.ts.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const decodeBase32 = (input: string): Uint8Array => {
  const cleaned = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) { bits -= 8; output.push((value >>> bits) & 0xff); }
  }
  return new Uint8Array(output);
};

export const extractSecret = (input: string): string => {
  if (input.startsWith("otpauth://")) {
    const url = new URL(input);
    return (url.searchParams.get("secret") ?? "").replace(/[\s=-]/g, "").toUpperCase();
  }
  return input.replace(/[\s=-]/g, "").toUpperCase();
};

export const generateTotpCode = async (
  secret: string,
  timeMs?: number,
  period = 30,
  digits = 6
): Promise<{ code: string; remaining: number }> => {
  const base32Secret = extractSecret(secret);
  const now = timeMs ?? Date.now();
  const counter = BigInt(Math.floor(now / 1000 / period));
  const remaining = period - (Math.floor(now / 1000) % period);

  const counterBytes = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { counterBytes[i] = Number(c & 0xffn); c >>= 8n; }

  const keyBytes = decodeBase32(base32Secret);
  const cryptoKey = await crypto.subtle.importKey("raw", keyBytes.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));

  const offset = signature[signature.length - 1]! & 0x0f;
  const binary = ((signature[offset]! & 0x7f) << 24) | ((signature[offset + 1]! & 0xff) << 16) | ((signature[offset + 2]! & 0xff) << 8) | (signature[offset + 3]! & 0xff);
  const otp = binary % 10 ** digits;
  return { code: otp.toString().padStart(digits, "0"), remaining };
};
