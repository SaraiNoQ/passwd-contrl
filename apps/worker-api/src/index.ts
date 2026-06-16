import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { bodyLimit } from "./middleware/body-limit";
import { csrf } from "./middleware/csrf";
import { errorHandler } from "./middleware/error-handler";
import { sessionMiddleware } from "./middleware/session";
import { healthRoutes } from "./routes/health";
import { buildAuthRoutes } from "./routes/auth";
import { buildVaultRoutes } from "./routes/vault";
import { buildRecoveryRoutes } from "./routes/recovery";
import { buildDeviceRoutes } from "./routes/devices";
import { buildMaintenanceRoutes } from "./routes/maintenance";
import { exportRoutes } from "./routes/exports";

const app = new Hono<{ Bindings: Env }>();

// ── Global Middleware ────────────────────────────────────────────────────────

// Safe error handler — never expose stack traces or internal messages
app.onError(errorHandler);

// CORS — always allows localhost/127.0.0.1 origins (for local frontend → deployed API).
// In development mode, dynamically echoes any origin. Otherwise falls back to CORS_ORIGIN.
app.use("*", async (c, next) => {
  const corsOrigin = c.env.CORS_ORIGIN ?? "*";
  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return corsOrigin;
      if (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:")) {
        return origin;
      }
      if (c.env.ENVIRONMENT === "development") return origin;
      return corsOrigin;
    },
    credentials: true
  });
  return corsMiddleware(c, next);
});

// 1MB body limit
app.use("*", bodyLimit());

// Request logger with redaction (never log request body)
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(
    `[request] ${c.req.method} ${c.req.path} → ${c.res.status} (${duration}ms)`
  );
});

// Session middleware — reads cookie, attaches user to context (non-blocking)
app.use("*", sessionMiddleware());

// CSRF protection for non-safe methods (skips when no session exists)
app.use("*", csrf());

// ── Routes ──────────────────────────────────────────────────────────────────

// Health routes (no auth required)
app.route("/", healthRoutes);

// Auth routes (registration, login, session, logout)
app.route("/", buildAuthRoutes());

// Vault sync routes (session required, handled per-route)
app.route("/", buildVaultRoutes());

// Recovery packet routes (session required)
app.route("/", buildRecoveryRoutes());

// Device trust routes (session required)
app.route("/", buildDeviceRoutes());

// Maintenance routes (token-based auth)
app.route("/", buildMaintenanceRoutes());

// Export routes (R2-based, session required)
app.route("/", exportRoutes);

// 404 fallback
app.notFound((c) => {
  return c.json({ error: "not_found" }, 404);
});

// Export for Cloudflare Worker
export default app;
