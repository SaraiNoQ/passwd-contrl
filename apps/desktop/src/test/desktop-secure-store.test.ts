import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemorySecureStore,
  type DesktopSecureStore,
} from "../lib/storage/desktop-secure-store";

describe("InMemorySecureStore", () => {
  let store: DesktopSecureStore;

  beforeEach(() => {
    store = new InMemorySecureStore();
  });

  // ── getItem ────────────────────────────────────────────────────────────────

  describe("getItem", () => {
    it("returns null for a non-existent key", async () => {
      const result = await store.getItem("nonexistent");
      expect(result).toBeNull();
    });

    it("returns the stored value after setItem", async () => {
      await store.setItem("session_token", "abc123");
      const result = await store.getItem("session_token");
      expect(result).toBe("abc123");
    });
  });

  // ── setItem ────────────────────────────────────────────────────────────────

  describe("setItem", () => {
    it("stores a value that can be retrieved", async () => {
      await store.setItem("device_id", "dev-001");
      expect(await store.getItem("device_id")).toBe("dev-001");
    });

    it("overwrites an existing value", async () => {
      await store.setItem("token", "old-value");
      await store.setItem("token", "new-value");
      expect(await store.getItem("token")).toBe("new-value");
    });

    it("stores multiple keys independently", async () => {
      await store.setItem("key_a", "value_a");
      await store.setItem("key_b", "value_b");
      expect(await store.getItem("key_a")).toBe("value_a");
      expect(await store.getItem("key_b")).toBe("value_b");
    });
  });

  // ── deleteItem ─────────────────────────────────────────────────────────────

  describe("deleteItem", () => {
    it("removes a stored value", async () => {
      await store.setItem("session", "xyz");
      await store.deleteItem("session");
      expect(await store.getItem("session")).toBeNull();
    });

    it("succeeds silently for a non-existent key", async () => {
      await expect(store.deleteItem("ghost")).resolves.toBeUndefined();
    });

    it("only deletes the targeted key", async () => {
      await store.setItem("keep", "yes");
      await store.setItem("remove", "no");
      await store.deleteItem("remove");
      expect(await store.getItem("keep")).toBe("yes");
      expect(await store.getItem("remove")).toBeNull();
    });
  });
});
