import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCredential, createEmptyLocalVault } from "./local-vault";
import { buildItemLevelSyncPlan, extractConflicts } from "./item-sync";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      input instanceof URL
        ? input
        : typeof input === "string"
          ? new URL(input)
          : input instanceof Request
            ? new URL(input.url)
            : null;

    if (url?.protocol === "file:") {
      return new Response(await readFile(url), {
        headers: {
          "Content-Type": "application/wasm"
        }
      });
    }

    return originalFetch(input, init);
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("item-level sync plan", () => {
  it.each(["crypto-core-wasm", "webcrypto-mvp"] as const)(
    "builds a sync plan with encrypted items for %s",
    async (runtime) => {
      const created = await createEmptyLocalVault("plan-test-password", runtime);
      const withItem = addCredential(created.unlocked, {
        title: "Plan Item",
        origin: "https://plan.example.com",
        username: "user",
        password: "pass",
        notes: ""
      });

      const { plan, itemInfos } = await buildItemLevelSyncPlan(
        withItem,
        "user-id-123",
        {},
        new Set()
      );

      expect(plan.protocol).toBe("item_level_v1");
      expect(plan.upserts).toHaveLength(1);
      expect(plan.upserts[0]!.id).toBe(withItem.snapshot.items[0]!.id);
      expect(plan.upserts[0]!.ownerUserId).toBe("user-id-123");
      expect(plan.upserts[0]!.encryptedPayload.ciphertext).not.toContain("pass");
      expect(plan.upserts[0]!.encryptedPayload.ciphertext).not.toContain("plan.example.com");

      expect(itemInfos).toHaveLength(1);
      expect(itemInfos[0]!.status).toBe("pending");
      expect(itemInfos[0]!.revision).toBeUndefined();
    }
  );

  it("marks items with existing revisions as synced", async () => {
    const created = await createEmptyLocalVault("rev-test-password", "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, {
      title: "Rev Item",
      origin: "https://rev.example.com",
      username: "user",
      password: "pass",
      notes: ""
    });
    const itemId = withItem.snapshot.items[0]!.id;

    const { itemInfos } = await buildItemLevelSyncPlan(
      withItem,
      "user-id",
      { [itemId]: 5 },
      new Set()
    );

    expect(itemInfos[0]!.status).toBe("synced");
    expect(itemInfos[0]!.revision).toBe(5);
  });

  it("uses the provided server base revision for follow-up syncs", async () => {
    const created = await createEmptyLocalVault("base-revision-test-password", "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, {
      title: "Second Sync Item",
      origin: "https://second-sync.example.com",
      username: "user",
      password: "pass",
      notes: ""
    });
    const itemId = withItem.snapshot.items[0]!.id;

    const { plan } = await buildItemLevelSyncPlan(
      withItem,
      "user-id",
      { [itemId]: 1 },
      new Set(),
      1
    );

    expect(plan.baseRevision).toBe(1);
  });

  it("skips conflicting items", async () => {
    const created = await createEmptyLocalVault("conflict-test-password", "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, {
      title: "Conflict Item",
      origin: "https://conflict.example.com",
      username: "user",
      password: "pass",
      notes: ""
    });
    const itemId = withItem.snapshot.items[0]!.id;

    const { plan, itemInfos } = await buildItemLevelSyncPlan(
      withItem,
      "user-id",
      {},
      new Set([itemId])
    );

    expect(plan.upserts).toHaveLength(0);
    expect(itemInfos[0]!.status).toBe("conflict");
  });
});

describe("extractConflicts", () => {
  it("extracts conflicts from item-level response", () => {
    const response = {
      protocol: "item_level_v1",
      conflicts: [
        { itemId: "00000000-0000-4000-8000-000000000001", operation: "upsert", reason: "server_revision_advanced", clientBaseRevision: 1, serverRevision: 2 }
      ]
    };
    const conflicts = extractConflicts(response);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.itemId).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("returns empty array for non-item-level response", () => {
    expect(extractConflicts({ serverRevision: 5 })).toEqual([]);
    expect(extractConflicts(null)).toEqual([]);
    expect(extractConflicts({ protocol: "legacy" })).toEqual([]);
  });
});
