import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

// Minimal in-memory IndexedDB mock for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMockIndexedDB = (): any => {
  const stores = new Map<string, Map<string, unknown>>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeRequest = (result: any): any => {
    const req: any = {
      result,
      readyState: "done",
      source: null,
      transaction: null,
      error: null,
      onsuccess: null,
      onerror: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    };
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess(new Event("success"));
    }, 0);
    return req;
  };

  return {
    open: (_name: string, _version?: number) => {
      const db: any = {
        objectStoreNames: {
          contains: (name: string) => stores.has(name),
          length: stores.size,
          item: (index: number) => [...stores.keys()][index] ?? null
        },
        createObjectStore: (name: string) => {
          stores.set(name, new Map());
        },
        transaction: (storeName: string, _mode: string) => {
          const store = stores.get(storeName) ?? new Map();
          stores.set(storeName, store);
          return {
            objectStore: () => ({
              put: (value: unknown, key: string) => {
                store.set(key, value);
                return makeRequest(undefined);
              },
              get: (key: string) => makeRequest(store.get(key))
            })
          };
        }
      };

      const req: any = {
        result: db,
        readyState: "done",
        source: null,
        transaction: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
        onupgradeneeded: null,
        onversionchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true)
      };
      setTimeout(() => {
        if (req.onupgradeneeded) req.onupgradeneeded(new Event("upgradeneeded"));
        if (req.onsuccess) req.onsuccess(new Event("success"));
      }, 0);
      return req;
    }
  };
};

describe("device-trust ECDH keypair", () => {
  it("splits 64-byte WASM output into private/public keys and stores correctly", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const setItemSpy = vi.fn();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => null),
        setItem: setItemSpy,
        removeItem: vi.fn(),
        clear: vi.fn()
      }
    });

    // Mock loadCryptoCore to avoid WASM initialization.
    // vi.hoisted keeps the factory variables accessible to vi.doMock.
    const { mockCryptoCore, fakePrivateKey } = vi.hoisted(() => {
      const fakePrivateKey = new Uint8Array(32);
      const fakePublicKey = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        fakePrivateKey[i] = i;
        fakePublicKey[i] = i + 32;
      }
      const combined = new Uint8Array(64);
      combined.set(fakePrivateKey);
      combined.set(fakePublicKey, 32);

      const mockCryptoCore = {
        generateDeviceKeypair: vi.fn(() => combined),
        encryptForDevice: vi.fn((_pk: Uint8Array, _vk: Uint8Array) => new Uint8Array([9, 9, 9])),
        decryptOnDevice: vi.fn((_sk: Uint8Array, _blob: Uint8Array) => new Uint8Array([1, 2, 3])),
        default: vi.fn()
      };
      return { mockCryptoCore, fakePrivateKey };
    });

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve(mockCryptoCore))
      };
    });

    const { generateDeviceKeypair } = await import("./device-trust");

    const publicKeyB64 = await generateDeviceKeypair();

    // Should call WASM generateDeviceKeypair
    expect(mockCryptoCore.generateDeviceKeypair).toHaveBeenCalledOnce();

    // Should return a base64url string
    expect(typeof publicKeyB64).toBe("string");
    expect(publicKeyB64.length).toBeGreaterThan(0);

    // Should store device ID in localStorage
    expect(setItemSpy).toHaveBeenCalled();
    const deviceIdCall = setItemSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("device-id")
    );
    expect(deviceIdCall).toBeTruthy();

    // Should store public key in localStorage
    const publicKeyCall = setItemSpy.mock.calls.find(
      (c: unknown[]) => typeof c[0] === "string" && c[0].includes("public-key")
    );
    expect(publicKeyCall).toBeTruthy();
    expect(publicKeyCall![1]).toBe(publicKeyB64);

    // Should store private key in IndexedDB (verified by the device-key-store mock)
    const keyStore = await import("./device-key-store");
    const storedKey = await keyStore.loadDevicePrivateKey();
    expect(storedKey).not.toBeNull();
    expect(storedKey).toEqual(fakePrivateKey);
  });

  it("returns existing public key on subsequent calls", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const existingPublicKey = "existing-pk-base64url";
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => {
          if (key.includes("device-id") && !key.includes("public-key")) return "existing-device-id";
          if (key.includes("public-key")) return existingPublicKey;
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      }
    });

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve({
          generateDeviceKeypair: vi.fn(),
          default: vi.fn()
        }))
      };
    });

    const { generateDeviceKeypair } = await import("./device-trust");

    const publicKeyB64 = await generateDeviceKeypair();
    expect(publicKeyB64).toBe(existingPublicKey);
  });

  it("encryptVaultKeyForDevice calls WASM with correct arguments", async () => {
    const { mockEncrypted } = vi.hoisted(() => ({
      mockEncrypted: new Uint8Array([0xde, 0xad, 0xbe, 0xef])
    }));

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve({
          encryptForDevice: vi.fn(() => mockEncrypted),
          default: vi.fn()
        }))
      };
    });

    const { toBase64Url } = await import("./crypto-utils");
    const { encryptVaultKeyForDevice } = await import("./device-trust");

    const devicePk = "AQID";
    const vaultKey = new Uint8Array([1, 2, 3, 4]);

    const result = await encryptVaultKeyForDevice(devicePk, vaultKey);
    expect(result).toBe(toBase64Url(mockEncrypted));
  });

  it("decryptVaultKeyOnDevice reads private key from IndexedDB and calls WASM", async () => {
    const fakePrivateKey = new Uint8Array([10, 20, 30]);
    const { expectedPlaintext } = vi.hoisted(() => ({
      expectedPlaintext: new Uint8Array([1, 2, 3])
    }));

    vi.stubGlobal("indexedDB", createMockIndexedDB());
    const keyStore = await import("./device-key-store");
    // Uint8Array with only 3 elements won't match the 32-byte expectation in real code,
    // but for testing the wiring it's fine.
    await keyStore.saveDevicePrivateKey(fakePrivateKey);

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve({
          decryptOnDevice: vi.fn((_sk: Uint8Array, _blob: Uint8Array) => expectedPlaintext),
          default: vi.fn()
        }))
      };
    });

    const { decryptVaultKeyOnDevice } = await import("./device-trust");

    const result = await decryptVaultKeyOnDevice("AQID");
    expect(result).toEqual(expectedPlaintext);
  });
});

describe("device-key-store IndexedDB operations", () => {
  it("saves, loads, and checks for a device private key", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const { saveDevicePrivateKey, loadDevicePrivateKey, hasDevicePrivateKey } = await import("./device-key-store");

    // Initially no key
    expect(await hasDevicePrivateKey()).toBe(false);
    expect(await loadDevicePrivateKey()).toBeNull();

    // Save a key
    const key = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
      17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    await saveDevicePrivateKey(key);

    // Now should exist
    expect(await hasDevicePrivateKey()).toBe(true);
    const loaded = await loadDevicePrivateKey();
    expect(loaded).not.toBeNull();
    expect(loaded).toEqual(key);
  });

  it("overwrites an existing key on save", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const { saveDevicePrivateKey, loadDevicePrivateKey } = await import("./device-key-store");

    const key1 = new Uint8Array([1, 2, 3]);
    const key2 = new Uint8Array([4, 5, 6]);

    await saveDevicePrivateKey(key1);
    expect(await loadDevicePrivateKey()).toEqual(key1);

    await saveDevicePrivateKey(key2);
    expect(await loadDevicePrivateKey()).toEqual(key2);
  });
});

describe("registerDevice", () => {
  it("sends { name, fingerprint, publicKey } to POST /devices", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const publicKeyB64 = "test-public-key";
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => {
          if (key.includes("public-key")) return publicKeyB64;
          if (key.includes("device-id")) return "test-device-id";
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      }
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: "server-device-id",
          name: "Mac",
          publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          status: "pending"
        })
    });
    vi.stubGlobal("fetch", fetchSpy);

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve({
          generateDeviceKeypair: vi.fn(() => new Uint8Array(64)),
          default: vi.fn()
        }))
      };
    });

    const { registerDevice } = await import("./device-trust");

    await registerDevice("test-csrf");

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/devices");
    expect(options.method).toBe("POST");

    const body = JSON.parse(options.body as string);
    expect(body).toHaveProperty("publicKey");
    expect(body).toHaveProperty("fingerprint");
    expect(body).toHaveProperty("name");
    expect(body).not.toHaveProperty("deviceId");
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "zero-vault.local.device-id.v1",
      "server-device-id"
    );
  });

  it("retries with the legacy payload when the deployed API rejects fingerprint", async () => {
    vi.stubGlobal("indexedDB", createMockIndexedDB());

    const publicKeyB64 = "test-public-key";
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => {
          if (key.includes("public-key")) return publicKeyB64;
          if (key.includes("device-id")) return "test-device-id";
          return null;
        }),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
      }
    });

    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "invalid_register_device_request" })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "server-device-id",
            name: "Mac",
            publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            status: "pending"
          })
      });
    vi.stubGlobal("fetch", fetchSpy);

    vi.doMock("./local-vault", async (importOriginal) => {
      const original = await importOriginal<typeof import("./local-vault")>();
      return {
        ...original,
        loadCryptoCore: vi.fn(() => Promise.resolve({
          generateDeviceKeypair: vi.fn(() => new Uint8Array(64)),
          default: vi.fn()
        }))
      };
    });

    const { registerDevice } = await import("./device-trust");

    const result = await registerDevice("test-csrf");

    expect(result?.id).toBe("server-device-id");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchSpy.mock.calls[0]![1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchSpy.mock.calls[1]![1] as RequestInit).body as string);
    expect(firstBody).toHaveProperty("fingerprint");
    expect(secondBody).not.toHaveProperty("fingerprint");
    expect(secondBody).toEqual({ name: "Unknown Device", publicKey: publicKeyB64 });
  });
});
