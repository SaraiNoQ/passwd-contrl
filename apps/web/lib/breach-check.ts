/**
 * Privacy-preserving password breach detection via the
 * Have I Been Pwned k-anonymity API.
 *
 * Only the first 5 hex chars of SHA-1(password) ever leave the browser.
 * The full password and full hash are NEVER sent to any external API.
 *
 * Results are cached in an in-memory Map for the session only.
 * No results are persisted to localStorage / IndexedDB / disk.
 */

import { encodeText } from "./crypto-utils";

// ── SHA-1 via WebCrypto ──────────────────────────────────────────────────────

async function sha1(bytes: Uint8Array): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.digest("SHA-1", bytes as BufferSource);
}

async function sha1Hex(input: string): Promise<string> {
  const hash = await sha1(encodeText(input));
  return Array.from(new Uint8Array(hash), (b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

// ── In-memory session cache ──────────────────────────────────────────────────

/** Map from uppercase SHA-1 hex string → breach result. */
const cache = new Map<string, { breached: boolean; count: number }>();

/** Exported for tests so the cache can be reset between test cases. */
export function clearBreachCache(): void {
  cache.clear();
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface BreachResult {
  breached: boolean;
  /** How many times this password appears in known breaches. */
  count: number;
}

/**
 * Check a single plaintext password against HIBP.
 *
 * The password is hashed with SHA-1 locally. Only the first 5 hex chars
 * of the hash are sent to the HIBP range endpoint (k-anonymity).
 *
 * @returns BreachResult — `breached: true` and `count` if the
 *   password suffix was found in the HIBP response.
 */
export async function checkPasswordBreach(password: string): Promise<BreachResult> {
  const fullHash = (await sha1Hex(password)).toUpperCase();
  const cached = cache.get(fullHash);
  if (cached) return cached;

  const prefix = fullHash.slice(0, 5);
  const suffix = fullHash.slice(5);

  try {
    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      { headers: { "User-Agent": "ZeroVault-PasswordHealth/1.0" } }
    );

    if (!response.ok) {
      const fallback: BreachResult = { breached: false, count: 0 };
      // Do not cache failures — the request may succeed later.
      return fallback;
    }

    const body = await response.text();

    // Each line: "SUFFIX:COUNT"
    for (const line of body.split("\n")) {
      const parts = line.split(":");
      const hashSuffix = parts[0];
      const countStr = parts[1];
      if (hashSuffix === suffix && countStr !== undefined) {
        const result: BreachResult = {
          breached: true,
          count: parseInt(countStr, 10),
        };
        cache.set(fullHash, result);
        return result;
      }
    }

    const result: BreachResult = { breached: false, count: 0 };
    cache.set(fullHash, result);
    return result;
  } catch {
    // Network error — treat as not breached so the user is not alarmed
    // spuriously (the app does not block usage on breach status).
    return { breached: false, count: 0 };
  }
}

/**
 * Check multiple passwords against HIBP with concurrency control.
 *
 * Requests are sent in batches of at most `concurrency` (default 3)
 * concurrent fetches. A 1500 ms delay is inserted between batches
 * to respect the HIBP rate limit (~1 req/s).
 *
 * @returns Map from credential `id` → BreachResult.
 */
export async function checkPasswordsBreach(
  items: Array<{ id: string; password: string }>,
  concurrency = 3,
  delayMs = 1500,
): Promise<Map<string, BreachResult>> {
  const results = new Map<string, BreachResult>();

  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(async ({ id, password }) => {
        const result = await checkPasswordBreach(password);
        return { id, ...result };
      })
    );

    for (const { id, breached, count } of batchResults) {
      results.set(id, { breached, count });
    }

    // Rate-limit pause between batches (skip after the last batch).
    if (i + concurrency < items.length) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return results;
}
