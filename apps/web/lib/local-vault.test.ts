import { readFile } from "node:fs/promises";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parsePasswordCsv } from "./csv-import";
import {
  addCredential,
  createEmptyLocalVault,
  persistUnlockedVault,
  unlockLocalVault,
  unlockLocalVaultWithRecoveredKey,
  sealUnlockedVault,
  encryptItemForSync,
  decryptItemFromSync,
} from "./local-vault";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

const tamperBase64Url = (value: string): string => {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
};

describe("local vault encryption", () => {
  it("creates, seals, and unlocks a crypto-core WASM vault by default", async () => {
    const created = await createEmptyLocalVault("long master password");
    const withItem = addCredential(created.unlocked, {
      title: "Example",
      origin: "https://example.com",
      username: "alice",
      password: "secret-password",
      notes: ""
    });
    const encrypted = await sealUnlockedVault(withItem);

    expect(encrypted.runtime).toBe("crypto-core-wasm");
    expect(encrypted.kdf.alg).toBe("ARGON2ID_V13");
    expect(encrypted.cipher.alg).toBe("XCHACHA20_POLY1305");
    expect(encrypted.cipher.ciphertext).not.toContain("secret-password");
    expect(encrypted.cipher.ciphertext).not.toContain("example.com");

    const unlocked = await unlockLocalVault("long master password", encrypted);
    expect(unlocked.snapshot.items[0]).toMatchObject({
      origin: "https://example.com",
      username: "alice"
    });
  });

  it("keeps legacy WebCrypto vaults unlockable and re-seals them without changing runtime", async () => {
    const created = await createEmptyLocalVault("legacy master password", "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, {
      title: "Legacy",
      origin: "https://legacy.example",
      username: "bob",
      password: "legacy-secret",
      notes: ""
    });
    const encrypted = await sealUnlockedVault(withItem);

    expect(encrypted.runtime).toBe("webcrypto-mvp");
    expect(encrypted.kdf.alg).toBe("PBKDF2_SHA256");
    expect(encrypted.cipher.alg).toBe("AES_256_GCM");

    const unlocked = await unlockLocalVault("legacy master password", encrypted);
    const resealed = await sealUnlockedVault(unlocked);

    expect(resealed.runtime).toBe("webcrypto-mvp");
    expect(unlocked.snapshot.items[0]).toMatchObject({
      origin: "https://legacy.example",
      username: "bob"
    });
  });

  it.each(["crypto-core-wasm", "webcrypto-mvp"] as const)("rejects the wrong master password for %s", async (runtime) => {
    const created = await createEmptyLocalVault("correct password", runtime);

    await expect(unlockLocalVault("wrong password", created.encrypted)).rejects.toThrow();
  });

  it.each(["crypto-core-wasm", "webcrypto-mvp"] as const)("rejects tampered ciphertext for %s", async (runtime) => {
    const created = await createEmptyLocalVault("correct password", runtime);
    const tampered = JSON.parse(JSON.stringify(created.encrypted)) as typeof created.encrypted;
    tampered.cipher.ciphertext = tamperBase64Url(tampered.cipher.ciphertext);

    await expect(unlockLocalVault("correct password", tampered)).rejects.toThrow();
  });

  it.each(["crypto-core-wasm", "webcrypto-mvp"] as const)(
    "unlocks a local vault with a recovered raw vault key for %s",
    async (runtime) => {
      const created = await createEmptyLocalVault("recoverable master password", runtime);
      const withItem = addCredential(created.unlocked, {
        title: "Recoverable",
        origin: "https://recoverable.example.com",
        username: "recoverable@example.com",
        password: "recoverable-secret",
        notes: ""
      });
      const encrypted = await sealUnlockedVault(withItem);
      const keyBytes =
        withItem.runtime === "webcrypto-mvp"
          ? new Uint8Array(await crypto.subtle.exportKey("raw", withItem.key))
          : withItem.key;

      const recovered = await unlockLocalVaultWithRecoveredKey(encrypted, keyBytes);

      expect(recovered.snapshot.items[0]).toMatchObject({
        title: "Recoverable",
        origin: "https://recoverable.example.com",
        username: "recoverable@example.com",
        password: "recoverable-secret"
      });
    }
  );

  it("rejects an incorrect recovered raw vault key", async () => {
    const created = await createEmptyLocalVault("recoverable master password", "crypto-core-wasm");
    const encrypted = await sealUnlockedVault(created.unlocked);
    const wrongKey = new Uint8Array(32);
    wrongKey.fill(7);

    await expect(unlockLocalVaultWithRecoveredKey(encrypted, wrongKey)).rejects.toThrow();
  });

  it("persists CSV-imported credentials without plaintext in localStorage", async () => {
    const writes = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => writes.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => writes.set(key, value)),
        removeItem: vi.fn(),
        clear: vi.fn(() => writes.clear())
      }
    });
    const csvPassword = "plain-secret-DO-NOT-STORE";
    const csvOrigin = "https://vault-import.example.com";
    const csvUsername = "csv-user@example.com";
    const parsed = parsePasswordCsv(`name,url,username,password\nImported,${csvOrigin},${csvUsername},${csvPassword}`);
    const created = await createEmptyLocalVault("long master password", "webcrypto-mvp");
    const withCsvRows = parsed.rows.reduce(
      (vault, row) =>
        addCredential(vault, {
          title: row.title ?? "Imported",
          origin: row.origin,
          username: row.username,
          password: row.password,
          notes: row.notes ?? ""
        }),
      created.unlocked
    );

    await persistUnlockedVault(withCsvRows);
    const stored = Array.from(writes.values()).join("\n");

    expect(parsed.rows).toHaveLength(1);
    expect(stored).not.toContain(csvPassword);
    expect(stored).not.toContain(csvOrigin);
    expect(stored).not.toContain(csvUsername);
  });
});

describe("item-level encryption for sync", () => {
  it.each(["crypto-core-wasm", "webcrypto-mvp"] as const)(
    "encrypts and decrypts a single item for %s runtime",
    async (runtime) => {
      const created = await createEmptyLocalVault("sync-test-password", runtime);
      const withItem = addCredential(created.unlocked, {
        title: "Sync Item",
        origin: "https://sync.example.com",
        username: "sync-user",
        password: "sync-secret",
        notes: "",
      });
      const item = withItem.snapshot.items[0]!;

      const { encryptedItemKey, encryptedPayload } = await encryptItemForSync(
        withItem,
        item,
      );

      expect(encryptedItemKey.ciphertext).not.toContain("sync-secret");
      expect(encryptedPayload.ciphertext).not.toContain("sync-secret");

      const decrypted = await decryptItemFromSync(
        withItem,
        encryptedItemKey,
        encryptedPayload,
        item.id,
      );

      expect(decrypted).toMatchObject({
        title: "Sync Item",
        origin: "https://sync.example.com",
        username: "sync-user",
        password: "sync-secret",
      });
    },
  );

  it("rejects wrong vault key for item decryption (crypto-core-wasm)", async () => {
    const created = await createEmptyLocalVault("correct-password", "crypto-core-wasm");
    const withItem = addCredential(created.unlocked, {
      title: "Test",
      origin: "https://test.com",
      username: "u",
      password: "p",
      notes: "",
    });
    const item = withItem.snapshot.items[0]!;
    const { encryptedItemKey, encryptedPayload } = await encryptItemForSync(withItem, item);

    const otherVault = await createEmptyLocalVault("other-password", "crypto-core-wasm");
    await expect(
      decryptItemFromSync(otherVault.unlocked, encryptedItemKey, encryptedPayload, item.id),
    ).rejects.toThrow();
  });
});
