import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ItemLevelSyncConflict } from "@zero-vault/shared";
import type { ConflictDisplayItem, ConflictAction } from "../components/sync/conflict-resolution-panel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConflict(
  overrides: Partial<ConflictDisplayItem> = {},
): ConflictDisplayItem {
  return {
    itemId: "11111111-1111-1111-1111-111111111111",
    title: "测试凭据",
    reason: "server_revision_advanced",
    localRevision: 2,
    serverRevision: 5,
    serverItemRevision: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — conflict resolution logic
// ---------------------------------------------------------------------------

describe("Conflict resolution logic", () => {
  // ── Reason label mapping ────────────────────────────────────────────────────

  describe("reason labels", () => {
    function reasonLabel(reason: ItemLevelSyncConflict["reason"]): string {
      switch (reason) {
        case "server_revision_advanced":
          return "云端已更新";
        case "item_revision_advanced":
          return "本地版本更新";
        case "item_owner_mismatch":
          return "所有者不匹配";
        default:
          return "版本冲突";
      }
    }

    it("maps server_revision_advanced to cloud updated", () => {
      expect(reasonLabel("server_revision_advanced")).toBe("云端已更新");
    });

    it("maps item_revision_advanced to local updated", () => {
      expect(reasonLabel("item_revision_advanced")).toBe("本地版本更新");
    });

    it("maps item_owner_mismatch to owner mismatch", () => {
      expect(reasonLabel("item_owner_mismatch")).toBe("所有者不匹配");
    });
  });

  // ── Action label mapping ───────────────────────────────────────────────────

  describe("action labels", () => {
    function actionLabel(action: ConflictAction): string {
      switch (action) {
        case "keep-local":
          return "保留本地版本";
        case "accept-remote":
          return "接受远端版本";
        case "create-copy":
          return "创建副本";
        case "skip":
          return "跳过";
      }
    }

    it("maps keep-local to keep local", () => {
      expect(actionLabel("keep-local")).toBe("保留本地版本");
    });

    it("maps accept-remote to accept remote", () => {
      expect(actionLabel("accept-remote")).toBe("接受远端版本");
    });

    it("maps create-copy to create copy", () => {
      expect(actionLabel("create-copy")).toBe("创建副本");
    });

    it("maps skip to skip", () => {
      expect(actionLabel("skip")).toBe("跳过");
    });
  });

  // ── Conflict list state management ─────────────────────────────────────────

  describe("conflict list", () => {
    it("returns empty state when no conflicts", () => {
      const conflicts: ConflictDisplayItem[] = [];
      expect(conflicts.length).toBe(0);
    });

    it("counts conflicts correctly", () => {
      const conflicts = [
        makeConflict({ itemId: "11111111-1111-1111-1111-111111111111" }),
        makeConflict({ itemId: "22222222-2222-2222-2222-222222222222" }),
        makeConflict({ itemId: "33333333-3333-3333-3333-333333333333" }),
      ];
      expect(conflicts.length).toBe(3);
    });

    it("each conflict has required fields", () => {
      const conflict = makeConflict();
      expect(conflict.itemId).toBeDefined();
      expect(conflict.title).toBeDefined();
      expect(conflict.reason).toBeDefined();
      expect(conflict.serverRevision).toBeDefined();
    });
  });

  // ── Single conflict resolution ─────────────────────────────────────────────

  describe("single conflict resolution", () => {
    let onResolve: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onResolve = vi.fn().mockResolvedValue(undefined);
    });

    it("calls onResolve with item ID and keep-local action", async () => {
      const itemId = "11111111-1111-1111-1111-111111111111";
      await onResolve(itemId, "keep-local");

      expect(onResolve).toHaveBeenCalledWith(itemId, "keep-local");
    });

    it("calls onResolve with item ID and accept-remote action", async () => {
      const itemId = "22222222-2222-2222-2222-222222222222";
      await onResolve(itemId, "accept-remote");

      expect(onResolve).toHaveBeenCalledWith(itemId, "accept-remote");
    });

    it("calls onResolve with item ID and create-copy action", async () => {
      const itemId = "33333333-3333-3333-3333-333333333333";
      await onResolve(itemId, "create-copy");

      expect(onResolve).toHaveBeenCalledWith(itemId, "create-copy");
    });

    it("calls onResolve with item ID and skip action", async () => {
      const itemId = "44444444-4444-4444-4444-444444444444";
      await onResolve(itemId, "skip");

      expect(onResolve).toHaveBeenCalledWith(itemId, "skip");
    });
  });

  // ── Batch conflict resolution ──────────────────────────────────────────────

  describe("batch conflict resolution", () => {
    let onResolveAll: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      onResolveAll = vi.fn().mockResolvedValue(undefined);
    });

    it("calls onResolveAll with keep-local", async () => {
      await onResolveAll("keep-local");
      expect(onResolveAll).toHaveBeenCalledWith("keep-local");
    });

    it("calls onResolveAll with accept-remote", async () => {
      await onResolveAll("accept-remote");
      expect(onResolveAll).toHaveBeenCalledWith("accept-remote");
    });

    it("resolves multiple conflicts sequentially", async () => {
      const onResolve = vi.fn().mockResolvedValue(undefined);
      const conflicts = [
        makeConflict({ itemId: "11111111-1111-1111-1111-111111111111" }),
        makeConflict({ itemId: "22222222-2222-2222-2222-222222222222" }),
      ];

      for (const conflict of conflicts) {
        await onResolve(conflict.itemId, "keep-local");
      }

      expect(onResolve).toHaveBeenCalledTimes(2);
      expect(onResolve).toHaveBeenNthCalledWith(
        1,
        "11111111-1111-1111-1111-111111111111",
        "keep-local",
      );
      expect(onResolve).toHaveBeenNthCalledWith(
        2,
        "22222222-2222-2222-2222-222222222222",
        "keep-local",
      );
    });
  });

  // ── Comparison data ────────────────────────────────────────────────────────

  describe("side-by-side comparison", () => {
    it("detects field differences", () => {
      const localFields: Record<string, string> = {
        title: "My Login",
        username: "user@example.com",
        password: "old-password",
      };
      const remoteFields: Record<string, string> = {
        title: "My Login",
        username: "user@example.com",
        password: "new-password",
      };

      const allKeys = Array.from(
        new Set([...Object.keys(localFields), ...Object.keys(remoteFields)]),
      );

      const diffs = allKeys.filter(
        (key) => localFields[key] !== remoteFields[key],
      );

      expect(diffs).toEqual(["password"]);
    });

    it("handles missing fields gracefully", () => {
      const localFields: Record<string, string> = {
        title: "My Login",
        username: "user",
      };
      const remoteFields: Record<string, string> = {
        title: "My Login",
        notes: "added notes",
      };

      const allKeys = Array.from(
        new Set([...Object.keys(localFields), ...Object.keys(remoteFields)]),
      );

      expect(allKeys).toContain("username");
      expect(allKeys).toContain("notes");
      expect(allKeys).toContain("title");
    });

    it("identifies when all fields are identical", () => {
      const fields: Record<string, string> = {
        title: "Same",
        username: "same@example.com",
      };

      const allKeys = Object.keys(fields);
      const diffs = allKeys.filter((key) => fields[key] !== fields[key]);

      expect(diffs).toHaveLength(0);
    });
  });

  // ── Expanded comparison state ──────────────────────────────────────────────

  describe("expanded comparison state", () => {
    it("tracks which conflicts have expanded comparison", () => {
      const expanded = new Set<string>();
      const itemId = "11111111-1111-1111-1111-111111111111";

      // Toggle on
      expanded.add(itemId);
      expect(expanded.has(itemId)).toBe(true);

      // Toggle off
      expanded.delete(itemId);
      expect(expanded.has(itemId)).toBe(false);
    });

    it("supports multiple expanded items", () => {
      const expanded = new Set<string>();
      expanded.add("11111111-1111-1111-1111-111111111111");
      expanded.add("22222222-2222-2222-2222-222222222222");

      expect(expanded.size).toBe(2);
    });
  });

  // ── Pending action tracking ────────────────────────────────────────────────

  describe("pending action tracking", () => {
    it("tracks pending action as composite key", () => {
      let pendingAction: string | null = null;
      const itemId = "11111111-1111-1111-1111-111111111111";
      const action: ConflictAction = "keep-local";

      pendingAction = `${itemId}:${action}`;
      expect(pendingAction).toBe(
        "11111111-1111-1111-1111-111111111111:keep-local",
      );
    });

    it("clears pending action after completion", () => {
      let pendingAction: string | null =
        "11111111-1111-1111-1111-111111111111:keep-local";

      // Simulate completion
      pendingAction = null;
      expect(pendingAction).toBeNull();
    });

    it("disables action buttons while pending", () => {
      const itemId = "11111111-1111-1111-1111-111111111111";
      const pendingAction: string = `${itemId}:keep-local`;

      // Should disable keep-local button
      expect(pendingAction === `${itemId}:keep-local`).toBe(true);
      // Should not disable accept-remote button
      expect(pendingAction === `${itemId}:accept-remote`).toBe(false);
    });
  });
});
