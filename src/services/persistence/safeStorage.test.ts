/**
 * Tests for safeStorage.ts — safe localStorage wrapper for Zustand.
 *
 * Covers: getItem, setItem, removeItem, QuotaExceededError handling,
 * per-key toast warnings, non-quota error re-throwing, and multi-instance behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockToastWarning = vi.fn();

vi.mock("sonner", () => ({
  toast: { warning: mockToastWarning },
}));

// We need fresh imports to reset the warnedKeys closure
async function freshImport() {
  vi.resetModules();
  return import("./safeStorage");
}

describe("createSafeStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    mockToastWarning.mockClear();
  });

  // ---- getItem ----

  describe("getItem", () => {
    it("reads from localStorage", async () => {
      localStorage.setItem("test-key", "test-value");
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      expect(storage.getItem("test-key")).toBe("test-value");
    });

    it("returns null for missing keys", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      expect(storage.getItem("nonexistent")).toBeNull();
    });

    it("returns empty string for empty value", async () => {
      localStorage.setItem("empty", "");
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      expect(storage.getItem("empty")).toBe("");
    });
  });

  // ---- setItem ----

  describe("setItem", () => {
    it("writes to localStorage", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      storage.setItem("key", "value");
      expect(localStorage.getItem("key")).toBe("value");
    });

    it("overwrites existing values", async () => {
      localStorage.setItem("key", "old");
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      storage.setItem("key", "new");
      expect(localStorage.getItem("key")).toBe("new");
    });

    it("handles empty string value", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      storage.setItem("key", "");
      expect(localStorage.getItem("key")).toBe("");
    });

    it("handles CJK key and value", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      storage.setItem("\u952e", "\u503c");
      expect(localStorage.getItem("\u952e")).toBe("\u503c");
    });
  });

  // ---- removeItem ----

  describe("removeItem", () => {
    it("removes from localStorage", async () => {
      localStorage.setItem("key", "value");
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      storage.removeItem("key");
      expect(localStorage.getItem("key")).toBeNull();
    });

    it("does not throw for missing keys", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();
      expect(() => storage.removeItem("nonexistent")).not.toThrow();
    });
  });

  // ---- QuotaExceededError handling ----

  describe("QuotaExceededError handling", () => {
    let setItemSpy: ReturnType<typeof vi.spyOn>;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      setItemSpy?.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    function createQuotaError(): DOMException {
      return new DOMException("Storage quota exceeded", "QuotaExceededError");
    }

    it("catches QuotaExceededError without throwing", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      expect(() => storage.setItem("big-key", "x".repeat(1000))).not.toThrow();
    });

    it("logs error on every QuotaExceededError", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("key1", "value");
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[SafeStorage]",
        expect.stringContaining("QuotaExceededError"),
      );
    });

    it("shows toast warning per unique key", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("store-a", "value1");
      storage.setItem("store-b", "value2");

      expect(mockToastWarning).toHaveBeenCalledTimes(2);
    });

    it("shows toast only once per key on repeated failures", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("store-a", "v1");
      storage.setItem("store-a", "v2");
      storage.setItem("store-a", "v3");

      expect(mockToastWarning).toHaveBeenCalledTimes(1);
    });

    it("toast message includes the key name", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("my-store", "data");

      expect(mockToastWarning).toHaveBeenCalledWith(
        expect.stringContaining("my-store"),
      );
    });

    it("uses custom resolver when registered", async () => {
      const { createSafeStorage, setSafeStorageMessageResolver } =
        await freshImport();
      setSafeStorageMessageResolver(
        (key) => `Custom: ${key} is full`,
      );
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("settings", "data");
      expect(mockToastWarning).toHaveBeenCalledWith("Custom: settings is full");
    });

    it("logs error on every attempt even if toast is suppressed", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("key1", "value1");
      storage.setItem("key1", "value2");
      storage.setItem("key1", "value3");

      expect(consoleErrorSpy).toHaveBeenCalledTimes(3);
    });

    it("includes key name in error message", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw createQuotaError();
        });

      storage.setItem("my-store", "data");
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "[SafeStorage]",
        expect.stringContaining("my-store"),
      );
    });

    it("re-throws non-QuotaExceeded DOMExceptions", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new DOMException("Access denied", "SecurityError");
        });

      expect(() => storage.setItem("key", "val")).toThrow("Access denied");
    });

    it("re-throws non-DOMException errors", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new TypeError("Something went wrong");
        });

      expect(() => storage.setItem("key", "val")).toThrow(TypeError);
    });

    it("re-throws generic Error", async () => {
      const { createSafeStorage } = await freshImport();
      const storage = createSafeStorage();

      setItemSpy = vi
        .spyOn(Storage.prototype, "setItem")
        .mockImplementation(() => {
          throw new Error("Unknown error");
        });

      expect(() => storage.setItem("key", "val")).toThrow("Unknown error");
    });
  });

  // ---- Multiple storage instances ----

  describe("multiple instances", () => {
    it("share the same localStorage", async () => {
      const { createSafeStorage } = await freshImport();
      const storage1 = createSafeStorage();
      const storage2 = createSafeStorage();

      storage1.setItem("shared", "data");
      expect(storage2.getItem("shared")).toBe("data");
    });
  });
});
