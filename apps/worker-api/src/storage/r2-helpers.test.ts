import { describe, it, expect, beforeEach } from "vitest";
import { R2Storage } from "./r2-helpers";

// ── Mock R2Bucket ────────────────────────────────────────────────────────────

interface StoredObject {
  body: ArrayBuffer;
  metadata: Record<string, string>;
}

class MockR2Bucket implements R2Bucket {
  private objects = new Map<string, StoredObject>();

  async put(
    key: string,
    body: ReadableStream | ArrayBuffer | string,
    options?: R2PutOptions
  ): Promise<R2Object> {
    let arrayBody: ArrayBuffer;
    if (typeof body === "string") {
      arrayBody = new TextEncoder().encode(body).buffer as ArrayBuffer;
    } else if (body instanceof ArrayBuffer) {
      arrayBody = body;
    } else {
      // ReadableStream — not exercised in these tests
      arrayBody = new ArrayBuffer(0);
    }
    this.objects.set(key, {
      body: arrayBody,
      metadata: options?.customMetadata ?? {}
    });
    return {
      key,
      size: arrayBody.byteLength,
      etag: "mock-etag",
      httpEtag: '"mock-etag"',
      checksums: {} as any,
      uploaded: new Date(),
      httpMetadata: {},
      customMetadata: options?.customMetadata ?? {},
      range: null,
      storageClass: "Standard",
      ssec: null
    } as unknown as R2Object;
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    const stored = this.objects.get(key);
    if (!stored) {
      return null;
    }
    return {
      key,
      size: stored.body.byteLength,
      etag: "mock-etag",
      httpEtag: '"mock-etag"',
      checksums: {} as any,
      uploaded: new Date(),
      httpMetadata: {},
      customMetadata: stored.metadata,
      range: null,
      storageClass: "Standard",
      ssec: null,
      body: stored.body,
      bodyUsed: false,
      arrayBuffer: async () => stored.body,
      text: async () => new TextDecoder().decode(stored.body),
      json: async () => JSON.parse(new TextDecoder().decode(stored.body)),
      blob: async () => new Blob([stored.body]),
      clone: () => ({}) as any,
      writeHttpMetadata: () => {}
    } as unknown as R2ObjectBody;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    const prefix = options?.prefix ?? "";
    const objects: R2Object[] = [];
    for (const [key, stored] of this.objects.entries()) {
      if (key.startsWith(prefix)) {
        objects.push({
          key,
          size: stored.body.byteLength,
          etag: "mock-etag",
          httpEtag: '"mock-etag"',
          checksums: {} as any,
          uploaded: new Date(),
          httpMetadata: {},
          customMetadata: stored.metadata,
          range: null,
          storageClass: "Standard",
          ssec: null
        } as unknown as R2Object);
      }
    }
    return {
      objects,
      truncated: false,
      delimitedPrefixes: []
    } as unknown as R2Objects;
  }

  head(_key: string): Promise<R2Object | null> {
    throw new Error("Method not implemented.");
  }
  createMultipartUpload(
    _key: string,
    _options?: R2MultipartOptions
  ): Promise<R2MultipartUpload> {
    throw new Error("Method not implemented.");
  }
  resumeMultipartUpload(
    _key: string,
    _uploadId: string
  ): R2MultipartUpload {
    throw new Error("Method not implemented.");
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("R2Storage", () => {
  let bucket: MockR2Bucket;
  let storage: R2Storage;

  beforeEach(() => {
    bucket = new MockR2Bucket();
    storage = new R2Storage(bucket);
  });

  // Helpers
  const makeData = (content: string): ArrayBuffer =>
    new TextEncoder().encode(content).buffer as ArrayBuffer;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ── Export roundtrip ────────────────────────────────────────────────────

  describe("uploadExport / downloadExport roundtrip", () => {
    it("uploads and downloads encrypted data correctly", async () => {
      const userId = "user-aaa-111";
      const exportId = "exp-bbb-222";
      const data = makeData("encrypted-ciphertext-blob");

      await storage.uploadExport(userId, exportId, data);
      const result = await storage.downloadExport(userId, exportId);

      expect(result).not.toBeNull();
      const downloaded = await result!.arrayBuffer();
      expect(new Uint8Array(downloaded)).toEqual(new Uint8Array(data));
    });

    it("stores metadata alongside the object", async () => {
      const userId = "user-1";
      const exportId = "exp-1";
      const data = makeData("cipher");
      const metadata = { alg: "XCHACHA20_POLY1305", ts: "2024-01-01T00:00:00Z" };

      await storage.uploadExport(userId, exportId, data, metadata);
      const result = await storage.downloadExport(userId, exportId);

      expect(result).not.toBeNull();
      expect(result!.customMetadata).toEqual(metadata);
    });

    it("returns null for non-existent export", async () => {
      const result = await storage.downloadExport("nobody", "nothing");
      expect(result).toBeNull();
    });
  });

  // ── Delete ─────────────────────────────────────────────────────────────

  describe("deleteExport", () => {
    it("removes an existing export and returns true", async () => {
      const userId = "user-del";
      const exportId = "exp-del";
      await storage.uploadExport(userId, exportId, makeData("data"));

      const deleted = await storage.deleteExport(userId, exportId);
      expect(deleted).toBe(true);

      const result = await storage.downloadExport(userId, exportId);
      expect(result).toBeNull();
    });

    it("returns false when export does not exist", async () => {
      const deleted = await storage.deleteExport("ghost", "ghost");
      expect(deleted).toBe(false);
    });
  });

  // ── List ───────────────────────────────────────────────────────────────

  describe("listExports", () => {
    it("returns all exports for a user", async () => {
      await storage.uploadExport("user-list", "exp-1", makeData("a"));
      await storage.uploadExport("user-list", "exp-2", makeData("b"));
      await storage.uploadExport("user-list", "exp-3", makeData("c"));

      const exports = await storage.listExports("user-list");
      expect(exports).toHaveLength(3);
      const keys = exports.map((o) => o.key).sort();
      expect(keys).toEqual([
        "exports/user-list/exp-1",
        "exports/user-list/exp-2",
        "exports/user-list/exp-3"
      ]);
    });

    it("returns empty array when user has no exports", async () => {
      const exports = await storage.listExports("empty-user");
      expect(exports).toEqual([]);
    });
  });

  // ── Key format ─────────────────────────────────────────────────────────

  describe("key format", () => {
    it("uses UUID-style IDs in keys — no plaintext origin/username/password", async () => {
      const userId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const exportId = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
      const data = makeData("encrypted");

      await storage.uploadExport(userId, exportId, data);
      const exports = await storage.listExports(userId);

      expect(exports).toHaveLength(1);
      const key = exports[0]!.key;

      // Key should match the pattern exports/{userId}/{exportId}
      expect(key).toBe(`exports/${userId}/${exportId}`);

      // The key should NOT contain common secret-related words
      const forbidden = [
        "password",
        "origin",
        "username",
        "title",
        "notes",
        "master",
        "recovery"
      ];
      for (const word of forbidden) {
        expect(key.toLowerCase()).not.toContain(word);
      }
    });

    it("key segments are valid UUIDs when caller provides UUIDs", async () => {
      const userId = crypto.randomUUID();
      const exportId = crypto.randomUUID();

      await storage.uploadExport(userId, exportId, makeData("x"));
      const exports = await storage.listExports(userId);

      expect(exports).toHaveLength(1);
      const key = exports[0]!.key;
      const segments = key.split("/");

      expect(segments[0]).toBe("exports");
      expect(segments[1]).toMatch(uuidPattern);
      expect(segments[2]).toMatch(uuidPattern);
    });
  });

  // ── Metadata does not contain plaintext secrets ────────────────────────

  describe("metadata safety", () => {
    it("metadata only contains algorithm, timestamp, and size hints", async () => {
      const userId = "user-meta";
      const exportId = "exp-meta";
      const safeMetadata = {
        alg: "XCHACHA20_POLY1305",
        ts: "2024-06-01T12:00:00Z",
        size: "4096"
      };

      await storage.uploadExport(
        userId,
        exportId,
        makeData("cipher"),
        safeMetadata
      );
      const result = await storage.downloadExport(userId, exportId);

      expect(result!.customMetadata).toEqual(safeMetadata);

      // Ensure no secret-related keys leaked in
      const cm = result!.customMetadata!;
      const metaKeys = Object.keys(cm).concat(Object.values(cm));
      const forbidden = [
        "password",
        "origin",
        "username",
        "title",
        "notes",
        "master",
        "recovery",
        "plaintext"
      ];
      for (const entry of metaKeys) {
        for (const word of forbidden) {
          expect(entry.toLowerCase()).not.toContain(word);
        }
      }
    });
  });

  // ── User isolation ─────────────────────────────────────────────────────

  describe("user isolation", () => {
    it("different users' exports are isolated by key prefix", async () => {
      const user1 = "user-alpha";
      const user2 = "user-beta";

      await storage.uploadExport(user1, "exp-1", makeData("alpha-data"));
      await storage.uploadExport(user2, "exp-1", makeData("beta-data"));

      const list1 = await storage.listExports(user1);
      const list2 = await storage.listExports(user2);

      expect(list1).toHaveLength(1);
      expect(list2).toHaveLength(1);
      expect(list1[0]!.key).toBe("exports/user-alpha/exp-1");
      expect(list2[0]!.key).toBe("exports/user-beta/exp-1");

      // User 1 cannot see user 2's data
      const alphaResult = await storage.downloadExport(user1, "exp-1");
      const alphaData = await alphaResult!.text();
      expect(alphaData).toBe("alpha-data");

      const betaResult = await storage.downloadExport(user2, "exp-1");
      const betaData = await betaResult!.text();
      expect(betaData).toBe("beta-data");
    });
  });

  // ── Backup operations ──────────────────────────────────────────────────

  describe("backup operations", () => {
    it("uploads and downloads backups correctly", async () => {
      const userId = "user-bk";
      const backupId = "bk-123";
      const data = makeData("backup-ciphertext");

      await storage.uploadBackup(userId, backupId, data);
      const result = await storage.downloadBackup(userId, backupId);

      expect(result).not.toBeNull();
      const downloaded = await result!.arrayBuffer();
      expect(new Uint8Array(downloaded)).toEqual(new Uint8Array(data));
    });

    it("deletes backups", async () => {
      const userId = "user-bk-del";
      const backupId = "bk-del-1";
      await storage.uploadBackup(userId, backupId, makeData("data"));

      const deleted = await storage.deleteBackup(userId, backupId);
      expect(deleted).toBe(true);

      const result = await storage.downloadBackup(userId, backupId);
      expect(result).toBeNull();
    });

    it("returns false when deleting non-existent backup", async () => {
      const deleted = await storage.deleteBackup("ghost", "ghost-bk");
      expect(deleted).toBe(false);
    });
  });
});
