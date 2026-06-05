/**
 * Cryptographic utilities for Cloudflare Worker runtime.
 * Uses the Web Crypto API available in Workers (no Node.js crypto).
 */

/**
 * Generate a cryptographically random token.
 * Returns a base64url-encoded string (32 bytes = 43 chars).
 */
export function generateToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return base64UrlEncode(buffer);
}

/**
 * Hash a token using SHA-256.
 * Returns a base64url-encoded digest for safe storage.
 */
export async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(hashBuffer));
}

/**
 * Encode bytes to base64url (no padding).
 */
function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) {
    binary += String.fromCharCode(byte);
  }
  // Worker runtime has btoa available globally
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
