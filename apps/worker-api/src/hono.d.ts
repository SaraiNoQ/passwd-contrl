import type { RateLimitStore } from "./middleware/rate-limit";

declare module "hono" {
  interface ContextVariableMap {
    rateLimitStore?: RateLimitStore;
  }
}
