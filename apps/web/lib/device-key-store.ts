const DB_NAME = "zero-vault";
const STORE_NAME = "device-keys";
const KEY_NAME = "device-private-key";

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
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
  await withStore("readwrite", (store) => store.put(privateKey, KEY_NAME));
};

export const loadDevicePrivateKey = async (): Promise<Uint8Array | null> => {
  const result = await withStore("readonly", (store) => store.get(KEY_NAME));
  return result ? new Uint8Array(result as ArrayBuffer) : null;
};

export const hasDevicePrivateKey = async (): Promise<boolean> => {
  const key = await loadDevicePrivateKey();
  return key !== null;
};
