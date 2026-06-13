import { describe, it, expect, vi, beforeEach } from "vitest";
import { MobileApiClient } from "../lib/api/mobile-api-client";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("MobileApiClient", () => {
  let client: MobileApiClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new MobileApiClient({ baseUrl: "https://api.example.com" });
  });

  describe("fetchCurrentUser", () => {
    it("should return session user on success", async () => {
      const mockResponse = {
        user: { id: "u1", email: "test@example.com", serverRevision: 0 },
        csrfToken: "csrf123",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.fetchCurrentUser();
      expect(result.user.email).toBe("test@example.com");
      expect(result.csrfToken).toBe("csrf123");
    });

    it("should throw unauthorized on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      });

      await expect(client.fetchCurrentUser()).rejects.toThrow("unauthorized");
    });

    it("should throw network_error on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));

      await expect(client.fetchCurrentUser()).rejects.toThrow("network_error");
    });
  });

  describe("loginDirect", () => {
    it("should return session user on success", async () => {
      const mockResponse = {
        user: { id: "u1", email: "test@example.com", serverRevision: 0 },
        csrfToken: "csrf456",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.loginDirect("test@example.com", "password123");
      expect(result.user.email).toBe("test@example.com");
      expect(result.csrfToken).toBe("csrf456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/auth/login/direct"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ email: "test@example.com", password: "password123" }),
        })
      );
    });

    it("should throw invalid_credentials on 401", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "invalid_credentials" }),
      });

      await expect(client.loginDirect("test@example.com", "wrong")).rejects.toThrow("unauthorized");
    });
  });

  describe("loginStart", () => {
    it("should send login start request", async () => {
      const mockResponse = {
        loginSessionId: "session123",
        loginResponse: "base64response",
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.loginStart("test@example.com", "base64request");
      expect(result.loginSessionId).toBe("session123");
    });
  });

  describe("pullItems", () => {
    it("should pull items with server revision", async () => {
      const mockResponse = {
        serverRevision: 5,
        items: [],
        deletedItemIds: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const result = await client.pullItems(3);
      expect(result.serverRevision).toBe(5);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("serverRevision=3"),
        expect.anything()
      );
    });

    it("should pull all items when no revision given", async () => {
      const mockResponse = {
        serverRevision: 0,
        items: [],
        deletedItemIds: [],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      await client.pullItems();
      expect(mockFetch).toHaveBeenCalledWith(
        expect.not.stringContaining("serverRevision"),
        expect.anything()
      );
    });
  });

  describe("logout", () => {
    it("should send CSRF token", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      await client.logout("csrf-token");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "x-zero-vault-csrf": "csrf-token",
          }),
        })
      );
    });
  });
});
