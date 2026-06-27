import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri store plugin
const mockStore = {
  get: vi.fn(),
  set: vi.fn(),
  save: vi.fn(),
  delete: vi.fn(),
};

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn().mockResolvedValue(mockStore),
}));

// Must import after mocks
const { initSecureStorage, createSecureStorage, _resetForTesting } = await import("./secureStorage");

describe("secureStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTesting();
    mockStore.get.mockResolvedValue(null);
    mockStore.set.mockResolvedValue(undefined);
    mockStore.save.mockResolvedValue(undefined);
    mockStore.delete.mockResolvedValue(undefined);
    localStorage.clear();
  });

  describe("initSecureStorage", () => {
    it("migrates data from localStorage to Tauri store and clears localStorage", async () => {
      localStorage.setItem("test-key", '{"apiKey":"sk-123"}');
      mockStore.get.mockResolvedValue(null); // Not in Tauri store yet

      await initSecureStorage(["test-key"]);

      expect(mockStore.set).toHaveBeenCalledWith("test-key", '{"apiKey":"sk-123"}');
      expect(mockStore.save).toHaveBeenCalled();
      // localStorage MUST be cleared after migration
      expect(localStorage.getItem("test-key")).toBeNull();
    });

    it("prefers Tauri store data and clears localStorage", async () => {
      localStorage.setItem("test-key", '{"old":"data"}');
      mockStore.get.mockResolvedValue('{"new":"data"}');

      await initSecureStorage(["test-key"]);

      const storage = createSecureStorage();
      expect(storage.getItem("test-key")).toBe('{"new":"data"}');
      // localStorage MUST be cleared even when Tauri store has data
      expect(localStorage.getItem("test-key")).toBeNull();
    });

    it("falls back to localStorage when Tauri store fails", async () => {
      const { load } = await import("@tauri-apps/plugin-store");
      (load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not available"));
      _resetForTesting();
      localStorage.setItem("fallback-key", '{"data":"value"}');

      await initSecureStorage(["fallback-key"]);

      const storage = createSecureStorage();
      expect(storage.getItem("fallback-key")).toBe('{"data":"value"}');
      // In fallback mode, localStorage is the persistence layer — don't clear it
      expect(localStorage.getItem("fallback-key")).toBe('{"data":"value"}');
    });

    it("writes to localStorage in fallback mode", async () => {
      const { load } = await import("@tauri-apps/plugin-store");
      (load as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not available"));
      _resetForTesting();

      await initSecureStorage([]);

      const storage = createSecureStorage();
      storage.setItem("fb-write", "fb-value");
      expect(localStorage.getItem("fb-write")).toBe("fb-value");
    });

    it("falls back to localStorage when the plugin returns a malformed shape (T4)", async () => {
      // Plugin API drift / broken mock: `load` resolves to an object missing
      // the methods we rely on. The shape guard must reject it loudly so we
      // fall back rather than later invoking `undefined()`.
      const { load } = await import("@tauri-apps/plugin-store");
      (load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ wat: true });
      _resetForTesting();
      localStorage.setItem("shape-key", '{"data":"v"}');

      await initSecureStorage(["shape-key"]);

      const storage = createSecureStorage();
      expect(storage.getItem("shape-key")).toBe('{"data":"v"}');
      // Fallback mode keeps localStorage as the persistence layer.
      expect(localStorage.getItem("shape-key")).toBe('{"data":"v"}');
    });
  });

  describe("createSecureStorage", () => {
    it("returns cached data synchronously", async () => {
      mockStore.get.mockResolvedValue('{"key":"value"}');
      await initSecureStorage(["cached-key"]);

      const storage = createSecureStorage();
      expect(storage.getItem("cached-key")).toBe('{"key":"value"}');
    });

    it("returns null for unknown keys", () => {
      const storage = createSecureStorage();
      expect(storage.getItem("nonexistent")).toBeNull();
    });

    it("setItem updates cache immediately", async () => {
      await initSecureStorage([]);
      const storage = createSecureStorage();
      storage.setItem("new-key", "new-value");
      expect(storage.getItem("new-key")).toBe("new-value");
    });

    it("setItem syncs to Tauri store AND flushes to disk via save() (#1061)", async () => {
      await initSecureStorage([]);
      const storage = createSecureStorage();
      storage.setItem("bg-key", "bg-value");

      // Wait for async sync
      await new Promise((r) => setTimeout(r, 50));
      expect(mockStore.set).toHaveBeenCalledWith("bg-key", "bg-value");
      // store.set() only mutates memory; save() must flush to disk, otherwise
      // the change is lost on restart (the Ollama-config-not-persisted bug).
      expect(mockStore.save).toHaveBeenCalled();
    });

    it("removeItem clears cache immediately", async () => {
      await initSecureStorage([]);
      const storage = createSecureStorage();
      storage.setItem("del-key", "del-value");
      storage.removeItem("del-key");
      expect(storage.getItem("del-key")).toBeNull();
    });

    it("removeItem syncs to Tauri store AND flushes the deletion via save() (#1061)", async () => {
      await initSecureStorage([]);
      const storage = createSecureStorage();
      storage.setItem("rm-key", "rm-value");
      mockStore.save.mockClear();
      storage.removeItem("rm-key");

      await new Promise((r) => setTimeout(r, 50));
      expect(mockStore.delete).toHaveBeenCalledWith("rm-key");
      // Deletion must be flushed to disk too, not just removed from memory.
      expect(mockStore.save).toHaveBeenCalled();
    });

    it("setItem handles Tauri store write failure gracefully", async () => {
      await initSecureStorage([]);
      mockStore.set.mockRejectedValueOnce(new Error("write failed"));

      const storage = createSecureStorage();
      // Should not throw — error is caught and logged
      storage.setItem("fail-key", "fail-value");
      // Cache still updated
      expect(storage.getItem("fail-key")).toBe("fail-value");
      // Wait for async error handling
      await new Promise((r) => setTimeout(r, 50));
    });

    it("removeItem handles Tauri store delete failure gracefully", async () => {
      await initSecureStorage([]);
      mockStore.delete.mockRejectedValueOnce(new Error("delete failed"));

      const storage = createSecureStorage();
      storage.setItem("fail-rm", "value");
      // Should not throw
      storage.removeItem("fail-rm");
      expect(storage.getItem("fail-rm")).toBeNull();
      await new Promise((r) => setTimeout(r, 50));
    });
  });
});
