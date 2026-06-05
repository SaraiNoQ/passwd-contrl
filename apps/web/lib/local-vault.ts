import type * as CryptoCoreWasm from "@zero-vault/crypto-core-wasm";
import type { VaultItem, VaultLogin, VaultSecureNote, VaultCreditCard, VaultItemType, CustomField } from "@zero-vault/shared";
import { toBase64Url, fromBase64Url, randomBytes, toArrayBuffer, encodeText, decodeText } from "./crypto-utils";

export type { VaultItem, VaultLogin, VaultSecureNote, VaultCreditCard, VaultItemType, CustomField };

/** @deprecated Use VaultLogin instead */
export type VaultCredential = VaultLogin;

export type VaultSnapshot = {
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  items: VaultItem[];
};

export type LocalVaultRuntime = "crypto-core-wasm" | "webcrypto-mvp";

type LegacyWebCryptoVault = {
  schemaVersion: 1;
  runtime: "webcrypto-mvp";
  kdf: {
    alg: "PBKDF2_SHA256";
    iterations: number;
    salt: string;
  };
  cipher: {
    alg: "AES_256_GCM";
    nonce: string;
    ciphertext: string;
  };
  itemCount: number;
  updatedAt: string;
};

type CryptoCoreWasmVault = {
  schemaVersion: 1;
  runtime: "crypto-core-wasm";
  kdf: {
    alg: "ARGON2ID_V13";
    memoryKib: number;
    iterations: number;
    parallelism: number;
    salt: string;
  };
  cipher: {
    alg: "XCHACHA20_POLY1305";
    nonce: string;
    ciphertext: string;
  };
  itemCount: number;
  updatedAt: string;
};

export type EncryptedLocalVault = LegacyWebCryptoVault | CryptoCoreWasmVault;

/**
 * Serialized ciphertext envelope used for item-level and sync encryption.
 * The `nonce` and `ciphertext` are base64url-encoded.
 */
export type CiphertextEnvelope = {
  alg: "XCHACHA20_POLY1305" | "AES_256_GCM" | "HMAC_SHA256";
  nonce: string;
  ciphertext: string;
};

type LegacyUnlockedVault = {
  runtime: "webcrypto-mvp";
  key: CryptoKey;
  kdf: LegacyWebCryptoVault["kdf"];
  snapshot: VaultSnapshot;
};

type CryptoCoreUnlockedVault = {
  runtime: "crypto-core-wasm";
  key: Uint8Array;
  kdf: CryptoCoreWasmVault["kdf"];
  snapshot: VaultSnapshot;
};

export type UnlockedVault = LegacyUnlockedVault | CryptoCoreUnlockedVault;

export const LOCAL_VAULT_STORAGE_KEY = "zero-vault.local.encrypted-vault.v1";

const LOCAL_VAULT_AAD = "zero-vault.local-vault.v1";
const KDF_ITERATIONS = 310_000;
const AES_NONCE_BYTES = 12;
const XCHACHA20_NONCE_BYTES = 24;
const ARGON2ID_PARAMS = {
  memoryKib: 19_456,
  iterations: 2,
  parallelism: 1
} as const;

type CryptoCoreWasmModule = typeof CryptoCoreWasm;

let cryptoCorePromise: Promise<CryptoCoreWasmModule> | null = null;

const assertCrypto = () => {
  if (!globalThis.crypto?.subtle) {
    throw new Error("WebCrypto is not available in this runtime.");
  }
};

export const loadCryptoCore = async (): Promise<CryptoCoreWasmModule> => {
  cryptoCorePromise ??= import("@zero-vault/crypto-core-wasm").then(async (module) => {
    await module.default();
    return module;
  });
  return cryptoCorePromise;
};

const deriveWebCryptoKey = async (
  masterPassword: string,
  salt: Uint8Array,
  iterations: number
): Promise<CryptoKey> => {
  assertCrypto();
  const passwordBytes = encodeText(masterPassword);
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    toArrayBuffer(passwordBytes),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  // Extractable=true is required so the key can be re-imported as an HKDF key
  // for item-level key derivation. The raw bytes never leave the browser context.
  return globalThis.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations
    },
    baseKey,
    {
      name: "AES-GCM",
      length: 256
    },
    true,
    ["encrypt", "decrypt"]
  );
};

const deriveCryptoCoreKey = async (
  masterPassword: string,
  kdf: CryptoCoreWasmVault["kdf"]
): Promise<Uint8Array> => {
  const cryptoCore = await loadCryptoCore();
  return cryptoCore.deriveVaultKey(
    masterPassword,
    fromBase64Url(kdf.salt),
    kdf.memoryKib,
    kdf.iterations,
    kdf.parallelism
  );
};

const parseSnapshot = (plaintext: Uint8Array | ArrayBuffer): VaultSnapshot => {
  const parsed = JSON.parse(decodeText(plaintext)) as VaultSnapshot;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.items)) {
    throw new Error("Invalid vault payload.");
  }
  // Migration: old items without type field → login
  for (const item of parsed.items) {
    if (!("type" in item) || typeof item.type !== "string") {
      (item as Record<string, unknown>).type = "login";
    }
  }
  return parsed;
};

const encryptWebCryptoSnapshot = async (
  key: CryptoKey,
  kdf: LegacyWebCryptoVault["kdf"],
  snapshot: VaultSnapshot
): Promise<LegacyWebCryptoVault> => {
  const nonce = randomBytes(AES_NONCE_BYTES);
  const plaintext = encodeText(JSON.stringify(snapshot));
  const aad = encodeText(LOCAL_VAULT_AAD);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad)
    },
    key,
    toArrayBuffer(plaintext)
  );

  return {
    schemaVersion: 1,
    runtime: "webcrypto-mvp",
    kdf,
    cipher: {
      alg: "AES_256_GCM",
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(new Uint8Array(ciphertext))
    },
    itemCount: snapshot.items.length,
    updatedAt: snapshot.updatedAt
  };
};

const decryptWebCryptoSnapshot = async (key: CryptoKey, vault: LegacyWebCryptoVault): Promise<VaultSnapshot> => {
  const nonce = fromBase64Url(vault.cipher.nonce);
  const aad = encodeText(LOCAL_VAULT_AAD);
  const ciphertext = fromBase64Url(vault.cipher.ciphertext);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad)
    },
    key,
    toArrayBuffer(ciphertext)
  );

  return parseSnapshot(plaintext);
};

const encryptCryptoCoreSnapshot = async (
  key: Uint8Array,
  kdf: CryptoCoreWasmVault["kdf"],
  snapshot: VaultSnapshot
): Promise<CryptoCoreWasmVault> => {
  const cryptoCore = await loadCryptoCore();
  const sealed = cryptoCore.encryptXChaCha20(
    key,
    encodeText(JSON.stringify(snapshot)),
    encodeText(LOCAL_VAULT_AAD)
  );
  const nonce = sealed.slice(0, XCHACHA20_NONCE_BYTES);
  const ciphertext = sealed.slice(XCHACHA20_NONCE_BYTES);

  return {
    schemaVersion: 1,
    runtime: "crypto-core-wasm",
    kdf,
    cipher: {
      alg: "XCHACHA20_POLY1305",
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(ciphertext)
    },
    itemCount: snapshot.items.length,
    updatedAt: snapshot.updatedAt
  };
};

const decryptCryptoCoreSnapshot = async (key: Uint8Array, vault: CryptoCoreWasmVault): Promise<VaultSnapshot> => {
  const cryptoCore = await loadCryptoCore();
  const nonce = fromBase64Url(vault.cipher.nonce);
  const ciphertext = fromBase64Url(vault.cipher.ciphertext);
  const sealed = new Uint8Array(nonce.length + ciphertext.length);
  sealed.set(nonce);
  sealed.set(ciphertext, nonce.length);
  const plaintext = cryptoCore.decryptXChaCha20(key, sealed, encodeText(LOCAL_VAULT_AAD));

  return parseSnapshot(plaintext);
};

export const createEmptyLocalVault = async (
  masterPassword: string,
  runtime: LocalVaultRuntime = "crypto-core-wasm"
): Promise<{
  encrypted: EncryptedLocalVault;
  unlocked: UnlockedVault;
}> => {
  const now = new Date().toISOString();
  const snapshot: VaultSnapshot = {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    items: []
  };

  if (runtime === "webcrypto-mvp") {
    const salt = randomBytes(16);
    const key = await deriveWebCryptoKey(masterPassword, salt, KDF_ITERATIONS);
    const kdf: LegacyWebCryptoVault["kdf"] = {
      alg: "PBKDF2_SHA256",
      iterations: KDF_ITERATIONS,
      salt: toBase64Url(salt)
    };
    const encrypted = await encryptWebCryptoSnapshot(key, kdf, snapshot);

    return {
      encrypted,
      unlocked: {
        runtime: "webcrypto-mvp",
        key,
        kdf,
        snapshot
      }
    };
  }

  const cryptoCore = await loadCryptoCore();
  const kdf: CryptoCoreWasmVault["kdf"] = {
    alg: "ARGON2ID_V13",
    ...ARGON2ID_PARAMS,
    salt: toBase64Url(cryptoCore.generateSalt())
  };
  const key = await deriveCryptoCoreKey(masterPassword, kdf);
  const encrypted = await encryptCryptoCoreSnapshot(key, kdf, snapshot);

  return {
    encrypted,
    unlocked: {
      runtime: "crypto-core-wasm",
      key,
      kdf,
      snapshot
    }
  };
};

export const unlockLocalVault = async (
  masterPassword: string,
  encrypted: EncryptedLocalVault
): Promise<UnlockedVault> => {
  if (encrypted.runtime === "webcrypto-mvp") {
    const key = await deriveWebCryptoKey(masterPassword, fromBase64Url(encrypted.kdf.salt), encrypted.kdf.iterations);
    const snapshot = await decryptWebCryptoSnapshot(key, encrypted);
    return {
      runtime: "webcrypto-mvp",
      key,
      kdf: encrypted.kdf,
      snapshot
    };
  }

  const key = await deriveCryptoCoreKey(masterPassword, encrypted.kdf);
  const snapshot = await decryptCryptoCoreSnapshot(key, encrypted);
  return {
    runtime: "crypto-core-wasm",
    key,
    kdf: encrypted.kdf,
    snapshot
  };
};

export const unlockLocalVaultWithRecoveredKey = async (
  encrypted: EncryptedLocalVault,
  keyBytes: Uint8Array
): Promise<UnlockedVault> => {
  if (keyBytes.length !== 32) {
    throw new Error("Invalid recovered key length.");
  }

  if (encrypted.runtime === "webcrypto-mvp") {
    assertCrypto();
    const key = await globalThis.crypto.subtle.importKey(
      "raw",
      toArrayBuffer(keyBytes),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    const snapshot = await decryptWebCryptoSnapshot(key, encrypted);
    return {
      runtime: "webcrypto-mvp",
      key,
      kdf: encrypted.kdf,
      snapshot
    };
  }

  const snapshot = await decryptCryptoCoreSnapshot(keyBytes, encrypted);
  return {
    runtime: "crypto-core-wasm",
    key: keyBytes,
    kdf: encrypted.kdf,
    snapshot
  };
};

export const sealUnlockedVault = async (vault: UnlockedVault): Promise<EncryptedLocalVault> => {
  const updatedSnapshot: VaultSnapshot = {
    ...vault.snapshot,
    updatedAt: new Date().toISOString()
  };

  if (vault.runtime === "webcrypto-mvp") {
    return encryptWebCryptoSnapshot(vault.key, vault.kdf, updatedSnapshot);
  }

  return encryptCryptoCoreSnapshot(vault.key, vault.kdf, updatedSnapshot);
};

export const saveEncryptedLocalVault = (vault: EncryptedLocalVault) => {
  window.localStorage.setItem(LOCAL_VAULT_STORAGE_KEY, JSON.stringify(vault));
};

export function validateEncryptedBackup(data: unknown): data is EncryptedLocalVault {
  if (data === null || typeof data !== "object") return false;
  const obj = data as Record<string, unknown>;
  if (obj.schemaVersion !== 1) return false;
  if (obj.runtime !== "webcrypto-mvp" && obj.runtime !== "crypto-core-wasm") return false;
  if (typeof obj.kdf !== "object" || obj.kdf === null) return false;
  const kdf = obj.kdf as Record<string, unknown>;
  if (typeof kdf.alg !== "string" || typeof kdf.salt !== "string") return false;

  if (obj.runtime === "webcrypto-mvp") {
    if (kdf.alg !== "PBKDF2_SHA256" || typeof kdf.iterations !== "number") return false;
  } else {
    if (kdf.alg !== "ARGON2ID_V13" || typeof kdf.memoryKib !== "number" || typeof kdf.iterations !== "number" || typeof kdf.parallelism !== "number") return false;
  }

  if (typeof obj.cipher !== "object" || obj.cipher === null) return false;
  const cipher = obj.cipher as Record<string, unknown>;
  if (typeof cipher.alg !== "string" || typeof cipher.nonce !== "string" || typeof cipher.ciphertext !== "string") return false;

  if (obj.runtime === "webcrypto-mvp") {
    if (cipher.alg !== "AES_256_GCM") return false;
  } else {
    if (cipher.alg !== "XCHACHA20_POLY1305") return false;
  }

  if (typeof obj.itemCount !== "number" || typeof obj.updatedAt !== "string") return false;
  return true;
}

export const loadEncryptedLocalVault = (): EncryptedLocalVault | null => {
  const raw = window.localStorage.getItem(LOCAL_VAULT_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw) as EncryptedLocalVault;
  if (
    parsed.schemaVersion !== 1 ||
    (parsed.runtime !== "webcrypto-mvp" && parsed.runtime !== "crypto-core-wasm")
  ) {
    throw new Error("Unsupported local vault version.");
  }

  return parsed;
};

export const persistUnlockedVault = async (vault: UnlockedVault): Promise<{
  encrypted: EncryptedLocalVault;
  unlocked: UnlockedVault;
}> => {
  const encrypted = await sealUnlockedVault(vault);
  saveEncryptedLocalVault(encrypted);
  return {
    encrypted,
    unlocked: {
      ...vault,
      snapshot: {
        ...vault.snapshot,
        updatedAt: encrypted.updatedAt
      }
    }
  };
};

type ItemInput = Omit<VaultItem, "id" | "createdAt" | "updatedAt">;
/** @deprecated Use ItemInput */
type CredentialInput = Omit<VaultLogin, "id" | "createdAt" | "updatedAt" | "type" | "folder" | "customFields" | "totp"> & {
  type?: "login";
  folder?: string;
  customFields?: CustomField[];
  totp?: string;
};

export const addItem = (vault: UnlockedVault, item: ItemInput) => {
  const now = new Date().toISOString();
  const newItem = {
    ...item,
    folder: item.folder ?? "",
    notes: item.notes ?? "",
    customFields: item.customFields ?? [],
    id: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now
  } as unknown as VaultItem;

  return {
    ...vault,
    snapshot: {
      ...vault.snapshot,
      updatedAt: now,
      items: [newItem, ...vault.snapshot.items]
    }
  };
};

/** @deprecated Use addItem with type: "login" */
export const addCredential = (vault: UnlockedVault, item: CredentialInput) => {
  return addItem(vault, {
    type: "login",
    title: item.title,
    origin: item.origin,
    username: item.username,
    password: item.password,
    notes: item.notes ?? "",
    folder: item.folder ?? "",
    customFields: item.customFields ?? [],
    ...(item.totp !== undefined ? { totp: item.totp } : {})
  } as ItemInput);
};

export const updateItem = (
  vault: UnlockedVault,
  id: string,
  updates: Partial<Omit<VaultItem, "id" | "createdAt" | "updatedAt">>
): UnlockedVault => {
  const now = new Date().toISOString();
  return {
    ...vault,
    snapshot: {
      ...vault.snapshot,
      updatedAt: now,
      items: vault.snapshot.items.map((item) =>
        item.id === id ? { ...item, ...updates, updatedAt: now } as VaultItem : item
      )
    }
  } as UnlockedVault;
};

/** @deprecated Use updateItem */
export const updateCredential = (
  vault: UnlockedVault,
  id: string,
  updates: Partial<Omit<VaultLogin, "id" | "createdAt" | "updatedAt">>
) => {
  return updateItem(vault, id, updates);
};

export const deleteItem = (vault: UnlockedVault, id: string) => {
  const now = new Date().toISOString();
  return {
    ...vault,
    snapshot: {
      ...vault.snapshot,
      updatedAt: now,
      items: vault.snapshot.items.filter((item) => item.id !== id)
    }
  };
};

/** @deprecated Use deleteItem */
export const deleteCredential = (vault: UnlockedVault, id: string) => {
  return deleteItem(vault, id);
};

// ---------------------------------------------------------------------------
// Item-level encryption for sync
// ---------------------------------------------------------------------------

/** Derive a per-item AES-GCM key via WebCrypto HKDF for the legacy runtime. */
const deriveWebCryptoItemKey = async (
  vaultKey: CryptoKey,
  itemId: string,
): Promise<CryptoKey> => {
  assertCrypto();
  // Re-export and re-import the vault key with HKDF deriveBits usage,
  // because the vault CryptoKey was created with only encrypt/decrypt usages.
  const rawVaultKey = await globalThis.crypto.subtle.exportKey("raw", vaultKey);
  const hkdfKey = await globalThis.crypto.subtle.importKey(
    "raw",
    rawVaultKey,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const info = toArrayBuffer(encodeText(`zero-vault:item-key:${itemId}`));
  const rawBits = await globalThis.crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new ArrayBuffer(0), info },
    hkdfKey,
    256,
  );
  // Extractable=true so the key can be wrapped for sync transport
  return globalThis.crypto.subtle.importKey(
    "raw",
    rawBits,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
};

/** Encrypt a single item for sync transport. */
export const encryptItemForSync = async (
  vault: UnlockedVault,
  item: VaultItem,
): Promise<{
  encryptedItemKey: CiphertextEnvelope;
  encryptedPayload: CiphertextEnvelope;
}> => {
  const itemPayload = encodeText(JSON.stringify(item));

  if (vault.runtime === "crypto-core-wasm") {
    const cryptoCore = await loadCryptoCore();
    const itemKey = cryptoCore.deriveItemKey(vault.key, item.id);
    const sealed = cryptoCore.encryptItem(itemKey, itemPayload, item.id);
    const nonce = toBase64Url(sealed.slice(0, XCHACHA20_NONCE_BYTES));
    const ciphertext = toBase64Url(sealed.slice(XCHACHA20_NONCE_BYTES));

    const wrappedKey = cryptoCore.encryptXChaCha20(
      vault.key,
      itemKey,
      encodeText(`zero-vault:item-key-wrap:${item.id}`),
    );
    const wrapNonce = toBase64Url(wrappedKey.slice(0, XCHACHA20_NONCE_BYTES));
    const wrapCiphertext = toBase64Url(
      wrappedKey.slice(XCHACHA20_NONCE_BYTES),
    );

    return {
      encryptedItemKey: {
        alg: "XCHACHA20_POLY1305",
        nonce: wrapNonce,
        ciphertext: wrapCiphertext,
      },
      encryptedPayload: { alg: "XCHACHA20_POLY1305", nonce, ciphertext },
    };
  }

  // webcrypto-mvp path
  const itemKey = await deriveWebCryptoItemKey(vault.key, item.id);
  const nonce = randomBytes(AES_NONCE_BYTES);
  const aad = encodeText(`zero-vault:item:${item.id}:v1`);
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(aad),
    },
    itemKey,
    toArrayBuffer(itemPayload),
  );

  const wrapNonce = randomBytes(AES_NONCE_BYTES);
  const rawItemKey = new Uint8Array(
    await globalThis.crypto.subtle.exportKey("raw", itemKey),
  );
  const wrappedKey = await globalThis.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapNonce),
      additionalData: toArrayBuffer(
        encodeText(`zero-vault:item-key-wrap:${item.id}`),
      ),
    },
    vault.key,
    toArrayBuffer(rawItemKey),
  );

  return {
    encryptedItemKey: {
      alg: "AES_256_GCM",
      nonce: toBase64Url(wrapNonce),
      ciphertext: toBase64Url(new Uint8Array(wrappedKey)),
    },
    encryptedPayload: {
      alg: "AES_256_GCM",
      nonce: toBase64Url(nonce),
      ciphertext: toBase64Url(new Uint8Array(ciphertext)),
    },
  };
};

/** Decrypt a single item from sync transport. */
export const decryptItemFromSync = async (
  vault: UnlockedVault,
  encryptedItemKey: CiphertextEnvelope,
  encryptedPayload: CiphertextEnvelope,
  itemId: string,
): Promise<VaultItem> => {
  if (vault.runtime === "crypto-core-wasm") {
    const cryptoCore = await loadCryptoCore();

    const wrapNonce = fromBase64Url(encryptedItemKey.nonce);
    const wrapCiphertext = fromBase64Url(encryptedItemKey.ciphertext);
    const wrappedKey = new Uint8Array(
      wrapNonce.length + wrapCiphertext.length,
    );
    wrappedKey.set(wrapNonce);
    wrappedKey.set(wrapCiphertext, wrapNonce.length);
    const itemKey = cryptoCore.decryptXChaCha20(
      vault.key,
      wrappedKey,
      encodeText(`zero-vault:item-key-wrap:${itemId}`),
    );

    const payloadNonce = fromBase64Url(encryptedPayload.nonce);
    const payloadCiphertext = fromBase64Url(encryptedPayload.ciphertext);
    const sealed = new Uint8Array(
      payloadNonce.length + payloadCiphertext.length,
    );
    sealed.set(payloadNonce);
    sealed.set(payloadCiphertext, payloadNonce.length);
    const plaintext = cryptoCore.decryptItem(itemKey, sealed, itemId);

    return JSON.parse(decodeText(plaintext)) as VaultItem;
  }

  // webcrypto-mvp path
  const wrapNonce = fromBase64Url(encryptedItemKey.nonce);
  const wrappedKeyBytes = fromBase64Url(encryptedItemKey.ciphertext);
  const rawItemKey = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapNonce),
      additionalData: toArrayBuffer(
        encodeText(`zero-vault:item-key-wrap:${itemId}`),
      ),
    },
    vault.key,
    toArrayBuffer(wrappedKeyBytes),
  );
  const itemKey = await globalThis.crypto.subtle.importKey(
    "raw",
    rawItemKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const payloadNonce = fromBase64Url(encryptedPayload.nonce);
  const payloadCiphertext = fromBase64Url(encryptedPayload.ciphertext);
  const aad = encodeText(`zero-vault:item:${itemId}:v1`);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(payloadNonce),
      additionalData: toArrayBuffer(aad),
    },
    itemKey,
    toArrayBuffer(payloadCiphertext),
  );

  return JSON.parse(decodeText(plaintext)) as VaultItem;
};
