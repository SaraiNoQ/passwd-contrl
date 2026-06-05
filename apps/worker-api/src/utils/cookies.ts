/**
 * Cookie utilities for Cloudflare Worker runtime.
 * Parses and generates Set-Cookie headers without Node.js dependencies.
 */

export const SESSION_COOKIE_NAME = "zero_vault_session";
export const CSRF_HEADER_NAME = "x-zero-vault-csrf";

export interface CookieOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  path?: string;
  maxAge?: number;
  expires?: Date;
}

/**
 * Parse a Cookie header string into a key-value map.
 * Handles URL-encoded values and trims whitespace.
 */
export function parseCookies(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx < 0) continue;

    const key = pair.slice(0, eqIdx).trim();
    const value = pair.slice(eqIdx + 1).trim();

    if (!key) continue;

    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

/**
 * Generate a Set-Cookie header value with the given options.
 * Defaults: HttpOnly, SameSite=Lax, Path=/
 */
export function setCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  if (options.httpOnly !== false) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
  parts.push(`Path=${options.path ?? "/"}`);

  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${options.maxAge}`);
  }

  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }

  return parts.join("; ");
}

/**
 * Generate a Set-Cookie header that clears a cookie.
 */
export function clearCookie(name: string, path = "/"): string {
  return `${name}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`;
}
