const storage = new Map<string, string>();

let hasLocalStorage: boolean;
try {
  hasLocalStorage = typeof globalThis.localStorage !== "undefined";
} catch {
  hasLocalStorage = false;
}

if (!hasLocalStorage) {
  if (typeof globalThis.Storage === "undefined") {
    class StorageShim {}
    Object.defineProperty(globalThis, "Storage", {
      configurable: true,
      value: StorageShim,
    });
  }

  Object.defineProperties(Storage.prototype, {
    clear: {
      configurable: true,
      value: () => storage.clear(),
    },
    getItem: {
      configurable: true,
      value: (key: string) => storage.get(key) ?? null,
    },
    key: {
      configurable: true,
      value: (index: number) => Array.from(storage.keys())[index] ?? null,
    },
    removeItem: {
      configurable: true,
      value: (key: string) => storage.delete(key),
    },
    setItem: {
      configurable: true,
      value: (key: string, value: string) => storage.set(key, value),
    },
  });

  const localStorageShim = Object.create(Storage.prototype) as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageShim,
  });
  Object.defineProperty(localStorageShim, "length", {
    configurable: true,
    get: () => storage.size,
  });
}
