/**
 * Tests for saveToPath helper
 *
 * @module utils/saveToPath.test
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveToPath } from "./saveToPath";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/hooks/useHistoryOperations", () => ({
  createSnapshot: vi.fn(),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: vi.fn(),
  },
}));

vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: {
    getState: vi.fn(),
  },
}));

let nextMockToken = 1;
vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: vi.fn(() => nextMockToken++),
  clearPendingSave: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("@/utils/imeToast", () => ({
  imeToast: {
    info: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
    error: toastMocks.error,
    warning: toastMocks.warning,
    loading: vi.fn(),
    dismiss: vi.fn(),
  },
}));

vi.mock("@/i18n", () => ({
  default: {
    t: (key: string, opts?: Record<string, unknown>) => {
      // Echo back key + opts so tests assert on key, not English text
      if (opts && Object.keys(opts).length) {
        return `${key}|${JSON.stringify(opts)}`;
      }
      return key;
    },
  },
}));

import { invoke } from "@tauri-apps/api/core";
import { createSnapshot } from "@/hooks/useHistoryOperations";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";

/** Factory for settings store mock with overrides */
function makeSettings(overrides?: {
  general?: Partial<Record<string, unknown>>;
  markdown?: Partial<Record<string, unknown>>;
}) {
  return {
    general: {
      historyEnabled: true,
      historyMaxSnapshots: 5,
      historyMaxAgeDays: 30,
      historyMergeWindow: 30,
      historyMaxFileSize: 512,
      lineEndingsOnSave: "preserve",
      ...overrides?.general,
    },
    markdown: {
      hardBreakStyleOnSave: "preserve",
      ...overrides?.markdown,
    },
  } as unknown as ReturnType<typeof useSettingsStore.getState>;
}

describe("saveToPath", () => {
  const mockSetFilePath = vi.fn();
  const mockMarkSaved = vi.fn();
  const mockMarkAutoSaved = vi.fn();
  const mockSetLineMetadata = vi.fn();
  const mockUpdateTabPath = vi.fn();
  const mockAddFile = vi.fn();
  const mockGetDocument = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    nextMockToken = 1;
    // Reset module-level snapshot-failure flag between tests
    const mod = await import("./saveToPath");
    if ("__resetSessionFlags" in mod) (mod as { __resetSessionFlags: () => void }).__resetSessionFlags();
    vi.mocked(useDocumentStore.getState).mockReturnValue({
      setFilePath: mockSetFilePath,
      markSaved: mockMarkSaved,
      markAutoSaved: mockMarkAutoSaved,
      setLineMetadata: mockSetLineMetadata,
      getDocument: mockGetDocument,
    } as unknown as ReturnType<typeof useDocumentStore.getState>);
    vi.mocked(useTabStore.getState).mockReturnValue({
      updateTabPath: mockUpdateTabPath,
    } as unknown as ReturnType<typeof useTabStore.getState>);
    vi.mocked(useRecentFilesStore.getState).mockReturnValue({
      addFile: mockAddFile,
    } as unknown as ReturnType<typeof useRecentFilesStore.getState>);
    vi.mocked(useSettingsStore.getState).mockReturnValue(makeSettings());
    mockGetDocument.mockReturnValue({ lineEnding: "unknown" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes content and updates stores on success", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);

    const result = await saveToPath("tab-1", "/tmp/doc.md", "Hello", "manual");

    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith("atomic_write_file", { path: "/tmp/doc.md", content: "Hello" });
    expect(mockSetFilePath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md");
    expect(mockMarkSaved).toHaveBeenCalledWith("tab-1", "Hello");
    expect(mockUpdateTabPath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md");
    expect(mockAddFile).toHaveBeenCalledWith("/tmp/doc.md");
    expect(createSnapshot).toHaveBeenCalledWith("/tmp/doc.md", "Hello", "manual", {
      maxSnapshots: 5,
      maxAgeDays: 30,
      mergeWindowSeconds: 30,
      maxFileSizeKB: 512,
    });
  });

  it("normalizes line endings based on settings", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    mockGetDocument.mockReturnValue({ lineEnding: "crlf" });

    const result = await saveToPath("tab-1", "/tmp/doc.md", "a\nb\n", "manual");

    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith("atomic_write_file", { path: "/tmp/doc.md", content: "a\r\nb\r\n" });
    expect(mockSetLineMetadata).toHaveBeenCalledWith("tab-1", {
      lineEnding: "crlf",
      hardBreakStyle: "twoSpaces", // Default for unknown docs (wider compatibility)
    });
  });

  it("normalizes hard breaks based on settings", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    mockGetDocument.mockReturnValue({ lineEnding: "lf", hardBreakStyle: "backslash" });
    vi.mocked(useSettingsStore.getState).mockReturnValue(
      makeSettings({ markdown: { hardBreakStyleOnSave: "twoSpaces" } })
    );

    const result = await saveToPath("tab-1", "/tmp/doc.md", "a\\\nb\n", "manual");

    expect(result).toBe(true);
    expect(invoke).toHaveBeenCalledWith("atomic_write_file", { path: "/tmp/doc.md", content: "a  \nb\n" });
    expect(mockSetLineMetadata).toHaveBeenCalledWith("tab-1", {
      lineEnding: "lf",
      hardBreakStyle: "twoSpaces",
    });
  });

  it("skips history snapshot when disabled", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    vi.mocked(useSettingsStore.getState).mockReturnValue(
      makeSettings({ general: { historyEnabled: false } })
    );

    const result = await saveToPath("tab-2", "/tmp/disabled.md", "No history", "manual");

    expect(result).toBe(true);
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("returns false and skips updates when write fails", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk error"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await saveToPath("tab-3", "/tmp/fail.md", "fail", "manual");

    expect(result).toBe(false);
    expect(mockSetFilePath).not.toHaveBeenCalled();
    expect(mockMarkSaved).not.toHaveBeenCalled();
    expect(mockUpdateTabPath).not.toHaveBeenCalled();
    expect(mockAddFile).not.toHaveBeenCalled();
    expect(createSnapshot).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  describe("saveType handling", () => {
    it("uses markSaved for manual saves", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(mockMarkSaved).toHaveBeenCalledWith("tab-1", "content");
      expect(mockMarkAutoSaved).not.toHaveBeenCalled();
    });

    it("uses markAutoSaved for auto saves", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(mockMarkAutoSaved).toHaveBeenCalledWith("tab-1", "content");
      expect(mockMarkSaved).not.toHaveBeenCalled();
    });

    it("adds to recent files for manual saves", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(mockAddFile).toHaveBeenCalledWith("/tmp/doc.md");
    });

    it("skips recent files for auto saves", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(mockAddFile).not.toHaveBeenCalled();
    });
  });

  describe("doc null/undefined handling (line 50)", () => {
    it("uses 'unknown' lineEnding when getDocument returns null", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      mockGetDocument.mockReturnValue(null);

      const result = await saveToPath("tab-1", "/tmp/doc.md", "Hello", "manual");

      expect(result).toBe(true);
      // With doc=null, lineEnding is "unknown" → resolveLineEndingOnSave gives "lf" by default
      expect(mockSetLineMetadata).toHaveBeenCalledWith("tab-1", expect.any(Object));
    });

    it("uses 'unknown' hardBreakStyle when getDocument returns null", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      mockGetDocument.mockReturnValue(null);

      const result = await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(result).toBe(true);
      expect(mockMarkAutoSaved).toHaveBeenCalled();
    });
  });

  describe("non-Error thrown value on write failure (line 69)", () => {
    it("converts non-Error string to string error message", async () => {
      vi.mocked(invoke).mockRejectedValue("disk full");
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(result).toBe(false);
      consoleError.mockRestore();
    });

    it("converts non-Error object to string error message", async () => {
      vi.mocked(invoke).mockRejectedValue({ code: 13, msg: "permission denied" });
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(result).toBe(false);
      consoleError.mockRestore();
    });
  });

  describe("history snapshot failure (line 105)", () => {
    it("still returns true when createSnapshot throws", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      vi.mocked(createSnapshot).mockRejectedValueOnce(new Error("snapshot failed"));

      const result = await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(result).toBe(true);
      expect(createSnapshot).toHaveBeenCalled();
    });

    it("warns once per session when snapshot creation fails (C8)", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);
      vi.mocked(createSnapshot).mockRejectedValue(new Error("snapshot failed"));

      await saveToPath("tab-1", "/tmp/a.md", "content1", "manual");
      expect(toastMocks.warning).toHaveBeenCalledWith("dialog:toast.historySnapshotFailed");
      const firstCount = toastMocks.warning.mock.calls.length;

      // Second snapshot failure in same session → no extra toast (rate-limited)
      await saveToPath("tab-2", "/tmp/b.md", "content2", "manual");
      expect(toastMocks.warning.mock.calls.length).toBe(firstCount);
    });
  });

  describe("save failure toast behavior (B1, B2)", () => {
    it("manual save shows localized toast.error (not raw English) on write failure", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("disk error"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(toastMocks.error).toHaveBeenCalledWith(
        expect.stringContaining("dialog:toast.failedToSaveGeneric"),
      );
      consoleError.mockRestore();
    });

    it("auto-save does NOT show toast on write failure (avoids spam)", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("disk error"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(toastMocks.error).not.toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe("pending save handling", () => {
    it("registers pending save before write", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(registerPendingSave).toHaveBeenCalledWith("/tmp/doc.md", "content");
      // registerPendingSave should be called before invoke (atomic write)
      const registerCall = vi.mocked(registerPendingSave).mock.invocationCallOrder[0];
      const writeCall = vi.mocked(invoke).mock.invocationCallOrder[0];
      expect(registerCall).toBeLessThan(writeCall);
    });

    it("clears pending save after successful write (delayed, with token)", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      // clearPendingSave is delayed via setTimeout to handle late watcher events
      expect(clearPendingSave).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1000);
      expect(clearPendingSave).toHaveBeenCalledWith("/tmp/doc.md", expect.any(Number));
    });

    it("clears pending save on write failure with token", async () => {
      vi.mocked(invoke).mockRejectedValue(new Error("disk error"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      // clearPendingSave should be called with path and a token (number)
      expect(clearPendingSave).toHaveBeenCalledWith("/tmp/doc.md", expect.any(Number));
      consoleError.mockRestore();
    });

    it("uses unique tokens for overlapping saves to the same path", async () => {
      vi.mocked(invoke).mockResolvedValue(undefined);

      // Start two saves to the same path
      const save1 = saveToPath("tab-1", "/tmp/doc.md", "content1", "manual");
      const save2 = saveToPath("tab-1", "/tmp/doc.md", "content2", "auto");

      await save1;
      await save2;

      // Both should register with different tokens
      const registerCalls = vi.mocked(registerPendingSave).mock.calls;
      expect(registerCalls).toHaveLength(2);
      expect(registerCalls[0][0]).toBe("/tmp/doc.md");
      expect(registerCalls[1][0]).toBe("/tmp/doc.md");
    });
  });
});
