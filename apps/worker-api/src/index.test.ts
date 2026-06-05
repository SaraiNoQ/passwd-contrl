import { describe, it, expect } from "vitest";
import app from "./index";

// Helper to create a minimal test environment
const createEnv = () =>
  ({
    ENVIRONMENT: "production",
    CORS_ORIGIN: "http://localhost:3000"
  }) as any;

describe("Zero Vault Worker API", () => {
  describe("Health endpoints", () => {
    it("GET /health returns 200 with ok: true", async () => {
      const res = await app.request("/health", undefined, createEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: true });
    });

    it("GET /ready returns 200 with ok: true", async () => {
      const res = await app.request("/ready", undefined, createEnv());
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ ok: true });
    });
  });

  describe("Body limit", () => {
    it("rejects requests over 1MB with 413", async () => {
      const largeBody = "x".repeat(1_048_577);
      const res = await app.request(
        "/health",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(largeBody.length)
          },
          body: largeBody
        },
        createEnv()
      );
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("限制");
    });
  });

  describe("Error handling", () => {
    it("returns generic error in production mode", async () => {
      const res = await app.request("/not-a-real-route", undefined, createEnv());
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ error: "not_found" });
    });
  });

  describe("404 fallback", () => {
    it("returns 404 for unknown routes", async () => {
      const res = await app.request("/unknown/route", undefined, createEnv());
      expect(res.status).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body).toEqual({ error: "not_found" });
    });
  });
});
