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
  it("maps the server recent-authentication gate to an actionable message", async () => {
    const { getErrorMessage } = await importClient();
    expect(getErrorMessage(new Error("recent_authentication_required"))).toBe(
      "身份验证已过期，请使用主密码重新登录后再试"
    );
  });

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
      applied: { upsertedItemIds: [], deletedItemIds: [], mutationReceipts: [] },
      conflicts: [
        {
          itemId: "00000000-0000-4000-8000-000000000001",
          operation: "upsert",
          reason: "invalid_server_revision",
          clientBaseRevision: 4,
          serverRevision: 5,
          serverState: { kind: "missing" }
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

  it("normalizes 409 item sync error responses", async () => {
    const conflictResponse = {
      error: "sync_conflict",
      serverRevision: 5,
      applied: { upsertedItemIds: [], deletedItemIds: [], mutationReceipts: [] },
      conflicts: [
        {
          itemId: "00000000-0000-4000-8000-000000000001",
          operation: "upsert",
          reason: "invalid_server_revision",
          clientBaseRevision: 4,
          serverRevision: 5,
          serverState: { kind: "missing" }
        }
      ]
    };
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify(conflictResponse), {
        status: 409,
        headers: { "content-type": "application/json" }
      })
    ));

    const plan: ItemLevelSyncPlan = {
      protocol: "item_level_v1",
      baseRevision: 4,
      upserts: [],
      deletes: []
    };
    const { pushItemLevelSync } = await importClient("http://localhost:8787");

    await expect(pushItemLevelSync("csrf-1", plan)).resolves.toEqual({
      protocol: "item_level_v1",
      serverRevision: 5,
      applied: { upsertedItemIds: [], deletedItemIds: [], mutationReceipts: [] },
      conflicts: conflictResponse.conflicts,
    });
  });

  it("turns failed browser fetches into a stable network_error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));

    const { fetchCurrentUser } = await importClient("http://localhost:8787");
    await expect(fetchCurrentUser()).rejects.toThrow("network_error");
  });

  it("requires an explicit server acknowledgement before accepting account deletion", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const { deleteAccount } = await importClient("http://localhost:8787");
    await expect(deleteAccount("csrf-1")).resolves.toBeUndefined();
    await expect(deleteAccount("csrf-2")).rejects.toThrow("invalid_delete_account_response");

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      "http://localhost:8787/auth/account",
      expect.objectContaining({
        method: "DELETE",
        credentials: "include",
        headers: expect.objectContaining({
          "content-type": "application/json",
          "x-zero-vault-csrf": "csrf-1"
        })
      })
    );
  });

  it("distinguishes a missing recovery packet from v2, auth, and malformed responses", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "recovery_packet_not_found" }), {
        status: 404,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "recovery_v2_managed" }), {
        status: 409,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "not_authenticated" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      }))
      .mockResolvedValueOnce(new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" }
      }));
    vi.stubGlobal("fetch", fetchSpy);

    const { fetchRecoveryPacket } = await importClient("http://localhost:8787");

    await expect(fetchRecoveryPacket()).resolves.toBeNull();
    await expect(fetchRecoveryPacket()).rejects.toThrow("recovery_v2_managed");
    await expect(fetchRecoveryPacket()).rejects.toThrow("not_authenticated");
    await expect(fetchRecoveryPacket()).rejects.toThrow("recovery_packet_response_invalid");
  });

  it("downloads cloud exports as blobs with cookies", async () => {
    const fetchSpy = vi.fn(async () =>
      new Response("encrypted-backup", {
        status: 200,
        headers: { "content-type": "application/octet-stream" }
      })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const { downloadCloudExport } = await importClient("http://localhost:8787");
    const blob = await downloadCloudExport("export-1");

    await expect(blob.text()).resolves.toBe("encrypted-backup");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8787/exports/export-1",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "content-type": "application/json" })
      })
    );
  });

  it("maps internal auth error codes to Chinese user-facing text", async () => {
    const { getErrorMessage } = await importClient("http://localhost:8787");

    expect(getErrorMessage(new Error("invalid_credentials"))).toBe("邮箱或密码不正确");
  });
});
