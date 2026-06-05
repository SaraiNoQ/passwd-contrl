import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ItemLevelSyncPlan } from "@zero-vault/shared";

const importClient = async (apiUrl = "http://localhost:8787") => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", apiUrl);
  return import("./api-client");
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("uses NEXT_PUBLIC_API_URL and includes cookies on session requests", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ user: { id: "user-1", email: "user@example.com", serverRevision: 3 }, csrfToken: "csrf-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchCurrentUser } = await importClient("http://localhost:8787");
    await expect(fetchCurrentUser()).resolves.toEqual({
      user: { id: "user-1", email: "user@example.com", serverRevision: 3 },
      csrfToken: "csrf-1"
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8787/auth/me",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json" })
      })
    );
  });

  it("sends CSRF and keeps 409 item sync conflicts as normal responses", async () => {
    const conflictResponse = {
      protocol: "item_level_v1",
      serverRevision: 5,
      applied: { upsertedItemIds: [], deletedItemIds: [] },
      conflicts: [
        {
          itemId: "00000000-0000-4000-8000-000000000001",
          operation: "upsert",
          reason: "server_revision_advanced",
          clientBaseRevision: 4,
          serverRevision: 5
        }
      ]
    };
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify(conflictResponse), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const plan: ItemLevelSyncPlan = {
      protocol: "item_level_v1",
      baseRevision: 4,
      upserts: [],
      deletes: []
    };
    const { pushItemLevelSync } = await importClient("http://localhost:8787");

    await expect(pushItemLevelSync("csrf-1", plan)).resolves.toEqual(conflictResponse);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8787/vault/item-sync",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-zero-vault-csrf": "csrf-1"
        }),
        body: JSON.stringify(plan)
      })
    );
  });

  it("turns failed browser fetches into a stable network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const { fetchCurrentUser } = await importClient("http://localhost:8787");
    await expect(fetchCurrentUser()).rejects.toThrow("network_error");
  });
});
