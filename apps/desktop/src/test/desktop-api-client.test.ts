import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DesktopApiClient } from "../lib/api/desktop-api-client";

// ── Helpers ────────────────────────────────────────────────────────────────

function mockFetchJson(body: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function mockFetchNetworkError() {
  return vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
}

function mockFetchTimeout() {
  return vi.fn().mockRejectedValue(
    new DOMException("The operation was aborted.", "AbortError")
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("DesktopApiClient", () => {
  const BASE_URL = "https://api.example.com";
  let client: DesktopApiClient;

  beforeEach(() => {
    client = new DesktopApiClient({ baseUrl: BASE_URL, timeoutMs: 5_000 });
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Auth ──────────────────────────────────────────────────────────────

  describe("login flow", () => {
    it("loginStart sends POST to /auth/login/start", async () => {
      const startResponse = {
        loginSessionId: "550e8400-e29b-41d4-a716-446655440000",
        loginResponse: "base64-opaque-response",
      };
      vi.stubGlobal("fetch", mockFetchJson(startResponse));

      const result = await client.loginStart(
        "user@example.com",
        "base64-opaque-request"
      );

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/auth/login/start`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            email: "user@example.com",
            startLoginRequest: "base64-opaque-request",
          }),
        })
      );
      expect(result).toEqual(startResponse);
    });

    it("loginFinish sends POST to /auth/login/finish", async () => {
      const sessionResponse = {
        user: {
          id: "550e8400-e29b-41d4-a716-446655440001",
          email: "user@example.com",
          serverRevision: 0,
        },
        csrfToken: "csrf-token-value",
      };
      vi.stubGlobal("fetch", mockFetchJson(sessionResponse));

      const result = await client.loginFinish(
        "550e8400-e29b-41d4-a716-446655440000",
        "base64-opaque-finish"
      );

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/auth/login/finish`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({
            loginSessionId: "550e8400-e29b-41d4-a716-446655440000",
            finishLoginRequest: "base64-opaque-finish",
          }),
        })
      );
      expect(result).toEqual(sessionResponse);
    });
  });

  // ── Sync ──────────────────────────────────────────────────────────────

  describe("pullItems", () => {
    it("fetches items without serverRevision query", async () => {
      const pullResponse = {
        serverRevision: 3,
        items: [],
        deletedItemIds: [],
      };
      vi.stubGlobal("fetch", mockFetchJson(pullResponse));

      const result = await client.pullItems();

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/vault/item-sync`,
        expect.objectContaining({ credentials: "include" })
      );
      expect(result).toEqual(pullResponse);
    });

    it("includes serverRevision query param when provided", async () => {
      const pullResponse = {
        serverRevision: 5,
        items: [],
        deletedItemIds: [],
      };
      vi.stubGlobal("fetch", mockFetchJson(pullResponse));

      await client.pullItems(3);

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/vault/item-sync?serverRevision=3`,
        expect.objectContaining({ credentials: "include" })
      );
    });
  });

  // ── Error handling ────────────────────────────────────────────────────

  describe("device trust", () => {
    it("registerDevice sends POST to /devices", async () => {
      vi.stubGlobal("fetch", mockFetchJson({ ok: true }));

      await client.registerDevice("csrf-token", {
        name: "MacBook Pro",
        publicKey: "public-key",
      });

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/devices`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          headers: expect.objectContaining({
            "x-zero-vault-csrf": "csrf-token",
          }),
          body: JSON.stringify({
            name: "MacBook Pro",
            publicKey: "public-key",
          }),
        }),
      );
    });

    it("rejectDevice sends POST to /devices/:id/reject", async () => {
      vi.stubGlobal("fetch", mockFetchJson({ ok: true }));

      await client.rejectDevice(
        "csrf-token",
        "550e8400-e29b-41d4-a716-446655440000",
      );

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/devices/550e8400-e29b-41d4-a716-446655440000/reject`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
        }),
      );
    });

    it("shareVaultKey sends POST to /devices/:id/share-key", async () => {
      vi.stubGlobal("fetch", mockFetchJson({ ok: true }));

      await client.shareVaultKey(
        "csrf-token",
        "550e8400-e29b-41d4-a716-446655440000",
        "encrypted-key",
      );

      expect(fetch).toHaveBeenCalledWith(
        `${BASE_URL}/devices/550e8400-e29b-41d4-a716-446655440000/share-key`,
        expect.objectContaining({
          method: "POST",
          credentials: "include",
          body: JSON.stringify({ encryptedVaultKey: "encrypted-key" }),
        }),
      );
    });
  });

  describe("error handling", () => {
    it("throws 'unauthorized' on 401", async () => {
      vi.stubGlobal("fetch", mockFetchJson({ error: "unauthorized" }, 401));

      await expect(client.fetchCurrentUser()).rejects.toThrow("unauthorized");
    });

    it("throws 'forbidden' on 403", async () => {
      vi.stubGlobal("fetch", mockFetchJson({ error: "forbidden" }, 403));

      await expect(client.fetchCurrentUser()).rejects.toThrow("forbidden");
    });

    it("throws 'network_error' on fetch failure", async () => {
      vi.stubGlobal("fetch", mockFetchNetworkError());

      await expect(client.fetchCurrentUser()).rejects.toThrow("network_error");
    });

    it("throws 'request_timeout' on AbortError", async () => {
      vi.stubGlobal("fetch", mockFetchTimeout());

      await expect(client.fetchCurrentUser()).rejects.toThrow(
        "request_timeout"
      );
    });

    it("throws server error message for other status codes", async () => {
      vi.stubGlobal(
        "fetch",
        mockFetchJson({ error: "rate_limited" }, 429)
      );

      await expect(client.fetchCurrentUser()).rejects.toThrow("rate_limited");
    });

    it("throws generic status code when body has no error", async () => {
      vi.stubGlobal("fetch", mockFetchJson({}, 500));

      await expect(client.fetchCurrentUser()).rejects.toThrow(
        "request_failed_500"
      );
    });
  });

  // ── Config ────────────────────────────────────────────────────────────

  describe("config", () => {
    it("strips trailing slashes from baseUrl", () => {
      const c = new DesktopApiClient({ baseUrl: "https://api.example.com///" });
      expect(c.getBaseUrl()).toBe("https://api.example.com");
    });

    it("defaults timeout to 30s", () => {
      const c = new DesktopApiClient({ baseUrl: "https://api.example.com" });
      // Access private field via any cast for verification
      expect((c as unknown as { timeoutMs: number }).timeoutMs).toBe(30_000);
    });
  });
});
