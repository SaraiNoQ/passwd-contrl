import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  addCredential,
  createEmptyLocalVault,
  encryptItemForSync,
  decryptItemFromSync,
  LOCAL_VAULT_STORAGE_KEY,
  persistUnlockedVault,
  sealUnlockedVault,
  unlockLocalVault,
} from "./local-vault";
import { generateRecoveryCode, createRecoveryPacket, recoverVaultKey, RECOVERY_PACKET_STORAGE_KEY } from "./recovery";
import { randomBytes } from "./crypto-utils";

afterEach(() => {
  vi.unstubAllGlobals();
});

const SECRETS = {
  masterPassword: "ultra-secret-master-password-2026",
  wrongPassword: "wrong-password-attempt",
  credential: {
    title: "Bank of America",
    origin: "https://secure.bankofamerica.com",
    username: "john.doe@bank.com",
    password: "Super$ecretP@ssw0rd!",
    notes: "Main checking account, PIN: 9876",
  },
};

describe("security: localStorage stores only ciphertext", () => {
  it("sealed vault in localStorage contains no plaintext (webcrypto-mvp)", async () => {
    const writes = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => writes.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => writes.set(key, value)),
        removeItem: vi.fn(),
        clear: vi.fn(() => writes.clear()),
      },
    });

    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const withCredential = addCredential(created.unlocked, SECRETS.credential);
    await persistUnlockedVault(withCredential);

    const stored = Array.from(writes.values()).join("\n");

    // Plaintext secrets must never appear in stored data
    expect(stored).not.toContain(SECRETS.masterPassword);
    expect(stored).not.toContain(SECRETS.credential.password);
    expect(stored).not.toContain(SECRETS.credential.origin);
    expect(stored).not.toContain(SECRETS.credential.username);
    expect(stored).not.toContain(SECRETS.credential.notes);
    expect(stored).not.toContain(SECRETS.credential.title);

    // Verify it's actually stored under the expected key
    expect(writes.has(LOCAL_VAULT_STORAGE_KEY)).toBe(true);
  });

  it("recovery packet in localStorage contains no plaintext vault key or recovery code", async () => {
    const writes = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => writes.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => writes.set(key, value)),
        removeItem: vi.fn(),
        clear: vi.fn(() => writes.clear()),
      },
    });

    const { saveRecoveryPacket } = await import("./recovery");
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const packet = await createRecoveryPacket(code, vaultKey);

    saveRecoveryPacket(packet);
    const stored = Array.from(writes.values()).join("\n");

    // Recovery code should not be stored at all
    expect(stored).not.toContain(code);
    // Vault key bytes should not appear
    const vaultKeyBase64 = Buffer.from(vaultKey).toString("base64");
    expect(stored).not.toContain(vaultKeyBase64);

    // Verify it's stored under the expected key
    expect(writes.has(RECOVERY_PACKET_STORAGE_KEY)).toBe(true);
  });

  it("multiple credentials all remain encrypted in localStorage", async () => {
    const writes = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => writes.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => writes.set(key, value)),
        removeItem: vi.fn(),
        clear: vi.fn(() => writes.clear()),
      },
    });

    const credentials = [
      { title: "GitHub", origin: "https://github.com", username: "dev@github.com", password: "gh-token-123", notes: "" },
      { title: "AWS", origin: "https://aws.amazon.com", username: "admin@corp.com", password: "aws-secret-key", notes: "Production account" },
      { title: "Gmail", origin: "https://mail.google.com", username: "user@gmail.com", password: "gmail-pass!", notes: "" },
    ];

    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const withAll = credentials.reduce(
      (vault, cred) => addCredential(vault, cred),
      created.unlocked,
    );
    await persistUnlockedVault(withAll);

    const stored = Array.from(writes.values()).join("\n");

    for (const cred of credentials) {
      expect(stored).not.toContain(cred.password);
      expect(stored).not.toContain(cred.origin);
      expect(stored).not.toContain(cred.username);
      if (cred.notes) {
        expect(stored).not.toContain(cred.notes);
      }
    }
  });
});

describe("security: crypto failure paths", () => {
  it("wrong master password fails to unlock webcrypto-mvp vault", async () => {
    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    await expect(unlockLocalVault(SECRETS.wrongPassword, created.encrypted)).rejects.toThrow();
  });

  it("wrong recovery code fails to recover vault key", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const packet = await createRecoveryPacket(code, vaultKey);

    const wrongCode = generateRecoveryCode();
    await expect(recoverVaultKey(wrongCode, packet)).rejects.toThrow();
  });

  it("tampered recovery packet ciphertext fails", async () => {
    const code = generateRecoveryCode();
    const vaultKey = randomBytes(32);
    const packet = await createRecoveryPacket(code, vaultKey);

    const tampered = { ...packet, ciphertext: `${packet.ciphertext.slice(1)}A` };
    await expect(recoverVaultKey(code, tampered)).rejects.toThrow();
  });

  it("tampered vault ciphertext fails to decrypt for webcrypto-mvp", async () => {
    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const tampered = JSON.parse(JSON.stringify(created.encrypted)) as typeof created.encrypted;
    // Flip the first character of the ciphertext
    tampered.cipher.ciphertext = `${tampered.cipher.ciphertext[0] === "A" ? "B" : "A"}${tampered.cipher.ciphertext.slice(1)}`;

    await expect(unlockLocalVault(SECRETS.masterPassword, tampered)).rejects.toThrow();
  });

  it("item-level encrypt/decrypt with wrong vault key fails (webcrypto-mvp)", async () => {
    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, SECRETS.credential);
    const item = withItem.snapshot.items[0]!;
    const { encryptedItemKey, encryptedPayload } = await encryptItemForSync(withItem, item);

    const otherVault = await createEmptyLocalVault("different-master-password", "webcrypto-mvp");
    await expect(
      decryptItemFromSync(otherVault.unlocked, encryptedItemKey, encryptedPayload, item.id),
    ).rejects.toThrow();
  });

  it("item-level ciphertext does not contain plaintext after encrypt", async () => {
    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, SECRETS.credential);
    const item = withItem.snapshot.items[0]!;
    const { encryptedItemKey, encryptedPayload } = await encryptItemForSync(withItem, item);

    expect(encryptedPayload.ciphertext).not.toContain(SECRETS.credential.password);
    expect(encryptedPayload.ciphertext).not.toContain(SECRETS.credential.origin);
    expect(encryptedPayload.ciphertext).not.toContain(SECRETS.credential.username);
    expect(encryptedPayload.ciphertext).not.toContain(SECRETS.credential.notes);
    expect(encryptedItemKey.ciphertext).not.toContain(SECRETS.masterPassword);
  });

  it("seal/unlock roundtrip preserves data integrity", async () => {
    const created = await createEmptyLocalVault(SECRETS.masterPassword, "webcrypto-mvp");
    const withItem = addCredential(created.unlocked, SECRETS.credential);
    const sealed = await sealUnlockedVault(withItem);
    const unlocked = await unlockLocalVault(SECRETS.masterPassword, sealed);

    expect(unlocked.snapshot.items).toHaveLength(1);
    expect(unlocked.snapshot.items[0]).toMatchObject({
      title: SECRETS.credential.title,
      origin: SECRETS.credential.origin,
      username: SECRETS.credential.username,
      password: SECRETS.credential.password,
      notes: SECRETS.credential.notes,
    });
  });
});
