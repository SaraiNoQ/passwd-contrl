/**
 * Rate limiting middleware for Cloudflare Workers.
 *
 * Uses a simple in-memory sliding window counter.
 * Abstract interface allows swapping for D1/KV-based rate limiting later.
 *
 * Default: 10 requests per minute per IP for auth endpoints.
 */

import type { MiddlewareHandler } from "hono";

interface RateLimitEntry {
  timestamps: number[];
}

export interface RateLimitStore {
  increment(key: string, windowMs: number): number | Promise<number>;
  reset(key: string): void | Promise<void>;
}

/**
 * In-memory sliding window rate limit store.
 * Tracks request timestamps per key (typically IP address).
 *
 * NOTE: This resets on Worker restart. For persistent rate limiting,
 * swap with a D1/KV-backed implementation using the same interface.
 */
class MemoryRateLimitStore implements RateLimitStore {
  private store = new Map<string, RateLimitEntry>();
  private lastCleanup = Date.now();

  increment(key: string, windowMs: number): number {
    const now = Date.now();

    // Lazy cleanup: purge stale entries every 5 minutes
    if (now - this.lastCleanup > 5 * 60 * 1000) {
      this.lastCleanup = now;
      const maxWindow = 60 * 1000;
      for (const [k, entry] of this.store) {
        entry.timestamps = entry.timestamps.filter((ts) => ts > now - maxWindow);
        if (entry.timestamps.length === 0) {
          this.store.delete(k);
        }
      }
    }

    const entry = this.store.get(key);

    if (!entry) {
      this.store.set(key, { timestamps: [now] });
      return 1;
    }

    // Remove timestamps outside the sliding window
    const cutoff = now - windowMs;
    entry.timestamps = entry.timestamps.filter((ts) => ts > cutoff);
    entry.timestamps.push(now);

    return entry.timestamps.length;
  }

  reset(key: string): void {
    this.store.delete(key);
  }
}

export interface RateLimitOptions {
  /** Maximum requests allowed in the window. Default: 10 */
  max?: number;
  /** Window duration in milliseconds. Default: 60000 (1 minute) */
  windowMs?: number;
  /**
   * Function to extract the rate limit key from the request.
   * Default: uses CF-Connecting-IP or X-Forwarded-For or "unknown".
   */
  keyFn?: (c: { req: { header: (name: string) => string | undefined } }) => string;
  /** Optional external store (D1/KV). Falls back to in-memory if not provided. */
  store?: RateLimitStore;
}

// Shared in-memory store instance (persists across requests within the same isolate)
const defaultStore = new MemoryRateLimitStore();

/**
 * Rate limiting middleware using a sliding window algorithm.
 *
 * Returns 429 with Chinese error message when the limit is exceeded.
 * Sets standard rate limit headers on all responses.
 */
export const rateLimit = (options: RateLimitOptions = {}): MiddlewareHandler => {
  const max = options.max ?? 10;
  const windowMs = options.windowMs ?? 60_000;

  const getKey = options.keyFn ?? ((c) => {
    return (
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown"
    );
  });

  return async (c, next) => {
    // Resolve store per-request: context variable > options > default in-memory
    const store = c.get("rateLimitStore") ?? options.store ?? defaultStore;
    const key = getKey(c);
    const count = await store.increment(key, windowMs);

    // Set rate limit headers
    c.header("X-RateLimit-Limit", String(max));
    c.header("X-RateLimit-Remaining", String(Math.max(0, max - count)));
    c.header("X-RateLimit-Reset", String(Math.ceil((Date.now() + windowMs) / 1000)));

    if (count > max) {
      c.header("Retry-After", String(Math.ceil(windowMs / 1000)));
      return c.json({ error: "请求过于频繁，请稍后再试" }, 429);
    }

    await next();
  };
};

/**
 * Create a rate limit store backed by D1.
 * Rate limits persist across Worker isolate restarts.
 *
 * On D1 errors, requests are allowed through (fail-open)
 * to avoid blocking legitimate users during database issues.
 *
 * @example
 * const d1Store = createD1RateLimitStore(env.DB);
 * rateLimit({ store: d1Store })
 */
export function createD1RateLimitStore(db: D1Database): RateLimitStore {
  return {
    async increment(key: string, windowMs: number): Promise<number> {
      const now = Date.now();

      try {
        // Insert the current timestamp
        await db
          .prepare("INSERT OR IGNORE INTO rate_limits (key, timestamp) VALUES (?, ?)")
          .bind(key, now)
          .run();

        // Count timestamps within the sliding window
        const cutoff = now - windowMs;
        const countRow = await db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM rate_limits WHERE key = ? AND timestamp > ?"
          )
          .bind(key, cutoff)
          .first<{ cnt: number }>();

        // Delete timestamps outside the window (cleanup)
        await db
          .prepare("DELETE FROM rate_limits WHERE key = ? AND timestamp <= ?")
          .bind(key, cutoff)
          .run();

        return countRow?.cnt ?? 1;
      } catch (err) {
        // Fail-open: allow the request if D1 is unavailable
        console.error("[rate-limit] D1 error, allowing request:", err);
        return 0;
      }
    },

    async reset(key: string): Promise<void> {
      try {
        await db
          .prepare("DELETE FROM rate_limits WHERE key = ?")
          .bind(key)
          .run();
      } catch (err) {
        console.error("[rate-limit] D1 reset error:", err);
      }
    }
  };
}
