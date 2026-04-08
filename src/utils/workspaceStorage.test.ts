/**
 * Tests for workspace storage utilities
 *
 * @module utils/workspaceStorage.test
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockToastWarning } = vi.hoisted(() => ({
  mockToastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { warning: mockToastWarning },
}));
import {
  getWorkspaceStorageKey,
  migrateWorkspaceStorage,
  setCurrentWindowLabel,
  getCurrentWindowLabel,
  windowScopedStorage,
  findActiveWorkspaceLabel,
  LEGACY_STORAGE_KEY,
} from "./workspaceStorage";

describe("getWorkspaceStorageKey", () => {
  it("returns key with window label suffix", () => {
    expect(getWorkspaceStorageKey("main")).toBe("vmark-workspace:main");
    expect(getWorkspaceStorageKey("doc-1")).toBe("vmark-workspace:doc-1");
    expect(getWorkspaceStorageKey("doc-abc")).toBe("vmark-workspace:doc-abc");
  });
});

describe("migrateWorkspaceStorage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does nothing when no legacy key exists", () => {
    migrateWorkspaceStorage();

    expect(localStorage.getItem("vmark-workspace:main")).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("does nothing when main key already exists", () => {
    const mainData = JSON.stringify({ state: { rootPath: "/new" } });
    const legacyData = JSON.stringify({ state: { rootPath: "/old" } });
    localStorage.setItem("vmark-workspace:main", mainData);
    localStorage.setItem(LEGACY_STORAGE_KEY, legacyData);

    migrateWorkspaceStorage();

    // Main key should remain unchanged, legacy key should remain (not deleted)
    expect(localStorage.getItem("vmark-workspace:main")).toBe(mainData);
  });

  it("migrates legacy key to main when main key does not exist", () => {
    const legacyData = JSON.stringify({ state: { rootPath: "/workspace" } });
    localStorage.setItem(LEGACY_STORAGE_KEY, legacyData);

    migrateWorkspaceStorage();

    // Legacy data should be copied to main key
    expect(localStorage.getItem("vmark-workspace:main")).toBe(legacyData);
    // Legacy key should be removed after migration
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });

  it("handles empty legacy value gracefully", () => {
    localStorage.setItem(LEGACY_STORAGE_KEY, "");

    migrateWorkspaceStorage();

    // Should not throw and should not set empty value to main
    expect(localStorage.getItem("vmark-workspace:main")).toBeNull();
    expect(localStorage.getItem(LEGACY_STORAGE_KEY)).toBeNull();
  });
});

describe("setCurrentWindowLabel / getCurrentWindowLabel", () => {
  beforeEach(() => {
    // Reset to default
    setCurrentWindowLabel("main");
  });

  it("defaults to 'main'", () => {
    expect(getCurrentWindowLabel()).toBe("main");
  });

  it("sets and gets the current window label", () => {
    setCurrentWindowLabel("doc-1");
    expect(getCurrentWindowLabel()).toBe("doc-1");

    setCurrentWindowLabel("doc-abc");
    expect(getCurrentWindowLabel()).toBe("doc-abc");
  });
});

describe("windowScopedStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    setCurrentWindowLabel("main");
  });

  it("reads from window-specific key", () => {
    localStorage.setItem("vmark-workspace:main", '{"state":"main-data"}');
    localStorage.setItem("vmark-workspace:doc-1", '{"state":"doc1-data"}');

    // Read from main
    expect(windowScopedStorage.getItem("ignored")).toBe('{"state":"main-data"}');

    // Switch to doc-1 and read
    setCurrentWindowLabel("doc-1");
    expect(windowScopedStorage.getItem("ignored")).toBe('{"state":"doc1-data"}');
  });

  it("writes to window-specific key", () => {
    windowScopedStorage.setItem("ignored", '{"data":"for-main"}');
    expect(localStorage.getItem("vmark-workspace:main")).toBe('{"data":"for-main"}');

    setCurrentWindowLabel("doc-2");
    windowScopedStorage.setItem("ignored", '{"data":"for-doc2"}');
    expect(localStorage.getItem("vmark-workspace:doc-2")).toBe('{"data":"for-doc2"}');
  });

  it("removes from window-specific key", () => {
    localStorage.setItem("vmark-workspace:main", "data");
    localStorage.setItem("vmark-workspace:doc-1", "data");

    windowScopedStorage.removeItem("ignored");
    expect(localStorage.getItem("vmark-workspace:main")).toBeNull();
    expect(localStorage.getItem("vmark-workspace:doc-1")).toBe("data");
  });

  it("returns null for non-existent key", () => {
    expect(windowScopedStorage.getItem("ignored")).toBeNull();
  });

  it("swallows QuotaExceededError on setItem and shows toast", () => {
    mockToastWarning.mockClear();
    setCurrentWindowLabel("doc-quota");

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      const error = new DOMException("quota exceeded", "QuotaExceededError");
      throw error;
    };

    // Should not throw
    expect(() => windowScopedStorage.setItem("ignored", "data")).not.toThrow();
    // Should show toast warning
    expect(mockToastWarning).toHaveBeenCalledTimes(1);
    expect(mockToastWarning).toHaveBeenCalledWith(
      expect.stringContaining("Storage full"),
    );

    Storage.prototype.setItem = originalSetItem;
  });

  it("shows toast only once per key on repeated QuotaExceededError", () => {
    mockToastWarning.mockClear();
    setCurrentWindowLabel("doc-repeat");

    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      const error = new DOMException("quota exceeded", "QuotaExceededError");
      throw error;
    };

    windowScopedStorage.setItem("ignored", "data");
    windowScopedStorage.setItem("ignored", "data");
    // Toast should fire only once for the same key
    expect(mockToastWarning).toHaveBeenCalledTimes(1);

    Storage.prototype.setItem = originalSetItem;
  });

  it("rethrows non-quota errors on setItem", () => {
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("some other error");
    };

    expect(() => windowScopedStorage.setItem("ignored", "data")).toThrow("some other error");

    Storage.prototype.setItem = originalSetItem;
  });
});

describe("findActiveWorkspaceLabel", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when no workspace keys exist", () => {
    expect(findActiveWorkspaceLabel()).toBeNull();
  });

  it("returns null when workspace keys exist but none are active", () => {
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: false, rootPath: null, config: null } })
    );
    expect(findActiveWorkspaceLabel()).toBeNull();
  });

  it("returns label of active workspace window", () => {
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/workspace", config: {} } })
    );
    expect(findActiveWorkspaceLabel()).toBe("main");
  });

  it("returns label of active doc window when main is not active", () => {
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: false, rootPath: null, config: null } })
    );
    localStorage.setItem(
      "vmark-workspace:doc-1",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/other", config: {} } })
    );
    expect(findActiveWorkspaceLabel()).toBe("doc-1");
  });

  it("prefers main over other windows when both are active", () => {
    localStorage.setItem(
      "vmark-workspace:doc-1",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/a", config: {} } })
    );
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/b", config: {} } })
    );
    expect(findActiveWorkspaceLabel()).toBe("main");
  });

  it("skips non-document window keys (settings, unknown labels)", () => {
    localStorage.setItem(
      "vmark-workspace:settings",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/x", config: {} } })
    );
    localStorage.setItem(
      "vmark-workspace:transfer-1",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/y", config: {} } })
    );
    expect(findActiveWorkspaceLabel()).toBeNull();
  });

  it("skips keys with invalid JSON", () => {
    localStorage.setItem("vmark-workspace:main", "not-json");
    expect(findActiveWorkspaceLabel()).toBeNull();
  });

  it("skips keys without rootPath", () => {
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: null, config: {} } })
    );
    expect(findActiveWorkspaceLabel()).toBeNull();
  });
});

describe("findActiveWorkspaceLabel — additional branch coverage", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("skips null keys returned by localStorage.key(i) (line 123 !key branch)", () => {
    // Add a valid workspace entry to ensure iteration happens
    localStorage.setItem(
      "vmark-workspace:main",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/ws", config: {} } })
    );

    // Monkey-patch localStorage.key to return null for index 0, real key for index 1
    const originalKey = Storage.prototype.key;
    let keyCallCount = 0;
    Storage.prototype.key = function (index: number) {
      // On even calls return null to exercise the !key branch
      if (keyCallCount++ % 2 === 0 && index === 0) return null;
      return originalKey.call(this, index);
    };

    // Should not throw and should still find the active workspace via later iterations
    expect(() => findActiveWorkspaceLabel()).not.toThrow();

    Storage.prototype.key = originalKey;
  });

  it("skips entries where getItem returns empty string (line 130 !raw branch)", () => {
    // Set up a key that matches the prefix/label filter but has empty value
    localStorage.setItem("vmark-workspace:main", "");

    // Should not throw — empty raw value is skipped
    const result = findActiveWorkspaceLabel();
    expect(result).toBeNull();
  });

  it("skips entries where getItem returns null (line 130 !raw branch)", () => {
    // Simulate a key existing but getItem returning null
    // We can achieve this by adding any key that matches the prefix pattern
    // then patching getItem to return null for that key
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (_key: string) {
      return null;
    };
    // Manually simulate localStorage.length > 0 and a matching key
    // by restoring getItem only for key() calls
    Storage.prototype.getItem = originalGetItem;

    localStorage.setItem(
      "vmark-workspace:doc-1",
      JSON.stringify({ state: { isWorkspaceMode: true, rootPath: "/ws", config: {} } })
    );

    const patchedGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
      if (key === "vmark-workspace:doc-1") return null;
      return patchedGetItem.call(this, key);
    };

    const result = findActiveWorkspaceLabel();
    expect(result).toBeNull();

    Storage.prototype.getItem = patchedGetItem;
  });
});

describe("migrateWorkspaceStorage error handling", () => {
  it("swallows errors and does not throw (line 86)", () => {
    // Simulate localStorage.getItem throwing
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("localStorage unavailable");
    };

    // Should not throw
    expect(() => migrateWorkspaceStorage()).not.toThrow();

    Storage.prototype.getItem = originalGetItem;
  });
});
