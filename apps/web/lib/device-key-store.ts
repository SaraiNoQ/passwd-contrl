const DB_NAME = "zero-vault";
const STORE_NAME = "device-keys";
const KEY_NAME = "device-private-key";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("设备密钥存储不可用"));
      return;
    }

    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const withStore = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const request = fn(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

export const saveDevicePrivateKey = async (privateKey: Uint8Array): Promise<void> => {
  try {
    await withStore("readwrite", (store) => store.put(privateKey, KEY_NAME));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`设备密钥保存失败: ${message}`);
  }
};

export const loadDevicePrivateKey = async (): Promise<Uint8Array | null> => {
  try {
    const result = await withStore("readonly", (store) => store.get(KEY_NAME));
    return result ? new Uint8Array(result as ArrayBuffer) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`设备密钥读取失败: ${message}`);
  }
};

export const hasDevicePrivateKey = async (): Promise<boolean> => {
  try {
    const key = await loadDevicePrivateKey();
    return key !== null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`设备密钥读取失败: ${message}`);
  }
};
