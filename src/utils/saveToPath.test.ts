/**
 * Tests for saveToPath helper
 *
 * @module utils/saveToPath.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveToPath } from "./saveToPath";

vi.mock("@tauri-apps/plugin-fs", () => ({
  writeTextFile: vi.fn(),
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

vi.mock("@/utils/pendingSaves", () => ({
  registerPendingSave: vi.fn(),
  clearPendingSave: vi.fn(),
}));

import { writeTextFile } from "@tauri-apps/plugin-fs";
import { createSnapshot } from "@/hooks/useHistoryOperations";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useRecentFilesStore } from "@/stores/recentFilesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { registerPendingSave, clearPendingSave } from "@/utils/pendingSaves";

describe("saveToPath", () => {
  const mockSetFilePath = vi.fn();
  const mockMarkSaved = vi.fn();
  const mockMarkAutoSaved = vi.fn();
  const mockSetLineMetadata = vi.fn();
  const mockUpdateTabPath = vi.fn();
  const mockAddFile = vi.fn();
  const mockGetDocument = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      general: {
        historyEnabled: true,
        historyMaxSnapshots: 5,
        historyMaxAgeDays: 30,
        lineEndingsOnSave: "preserve",
      },
      markdown: {
        hardBreakStyleOnSave: "preserve",
      },
    } as unknown as ReturnType<typeof useSettingsStore.getState>);
    mockGetDocument.mockReturnValue({ lineEnding: "unknown" });
  });

  it("writes content and updates stores on success", async () => {
    vi.mocked(writeTextFile).mockResolvedValue(undefined);

    const result = await saveToPath("tab-1", "/tmp/doc.md", "Hello", "manual");

    expect(result).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/doc.md", "Hello");
    expect(mockSetFilePath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md");
    expect(mockMarkSaved).toHaveBeenCalledWith("tab-1");
    expect(mockUpdateTabPath).toHaveBeenCalledWith("tab-1", "/tmp/doc.md");
    expect(mockAddFile).toHaveBeenCalledWith("/tmp/doc.md");
    expect(createSnapshot).toHaveBeenCalledWith("/tmp/doc.md", "Hello", "manual", {
      maxSnapshots: 5,
      maxAgeDays: 30,
    });
  });

  it("normalizes line endings based on settings", async () => {
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    mockGetDocument.mockReturnValue({ lineEnding: "crlf" });

    const result = await saveToPath("tab-1", "/tmp/doc.md", "a\nb\n", "manual");

    expect(result).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/doc.md", "a\r\nb\r\n");
    expect(mockSetLineMetadata).toHaveBeenCalledWith("tab-1", {
      lineEnding: "crlf",
      hardBreakStyle: "backslash",
    });
  });

  it("normalizes hard breaks based on settings", async () => {
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    mockGetDocument.mockReturnValue({ lineEnding: "lf", hardBreakStyle: "backslash" });
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      general: {
        historyEnabled: true,
        historyMaxSnapshots: 5,
        historyMaxAgeDays: 30,
        lineEndingsOnSave: "preserve",
      },
      markdown: {
        hardBreakStyleOnSave: "twoSpaces",
      },
    } as unknown as ReturnType<typeof useSettingsStore.getState>);

    const result = await saveToPath("tab-1", "/tmp/doc.md", "a\\\nb\n", "manual");

    expect(result).toBe(true);
    expect(writeTextFile).toHaveBeenCalledWith("/tmp/doc.md", "a  \nb\n");
    expect(mockSetLineMetadata).toHaveBeenCalledWith("tab-1", {
      lineEnding: "lf",
      hardBreakStyle: "twoSpaces",
    });
  });

  it("skips history snapshot when disabled", async () => {
    vi.mocked(writeTextFile).mockResolvedValue(undefined);
    vi.mocked(useSettingsStore.getState).mockReturnValue({
      general: {
        historyEnabled: false,
        historyMaxSnapshots: 5,
        historyMaxAgeDays: 30,
        lineEndingsOnSave: "preserve",
      },
      markdown: {
        hardBreakStyleOnSave: "preserve",
      },
    } as unknown as ReturnType<typeof useSettingsStore.getState>);

    const result = await saveToPath("tab-2", "/tmp/disabled.md", "No history", "manual");

    expect(result).toBe(true);
    expect(createSnapshot).not.toHaveBeenCalled();
  });

  it("returns false and skips updates when write fails", async () => {
    vi.mocked(writeTextFile).mockRejectedValue(new Error("disk error"));
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
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(mockMarkSaved).toHaveBeenCalledWith("tab-1");
      expect(mockMarkAutoSaved).not.toHaveBeenCalled();
    });

    it("uses markAutoSaved for auto saves", async () => {
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(mockMarkAutoSaved).toHaveBeenCalledWith("tab-1");
      expect(mockMarkSaved).not.toHaveBeenCalled();
    });

    it("adds to recent files for manual saves", async () => {
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(mockAddFile).toHaveBeenCalledWith("/tmp/doc.md");
    });

    it("skips recent files for auto saves", async () => {
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "auto");

      expect(mockAddFile).not.toHaveBeenCalled();
    });
  });

  describe("pending save handling", () => {
    it("registers pending save before write", async () => {
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(registerPendingSave).toHaveBeenCalledWith("/tmp/doc.md", "content");
      // registerPendingSave should be called before writeTextFile
      const registerCall = vi.mocked(registerPendingSave).mock.invocationCallOrder[0];
      const writeCall = vi.mocked(writeTextFile).mock.invocationCallOrder[0];
      expect(registerCall).toBeLessThan(writeCall);
    });

    it("clears pending save after successful write", async () => {
      vi.mocked(writeTextFile).mockResolvedValue(undefined);

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(clearPendingSave).toHaveBeenCalledWith("/tmp/doc.md");
    });

    it("clears pending save on write failure", async () => {
      vi.mocked(writeTextFile).mockRejectedValue(new Error("disk error"));
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

      await saveToPath("tab-1", "/tmp/doc.md", "content", "manual");

      expect(clearPendingSave).toHaveBeenCalledWith("/tmp/doc.md");
      consoleError.mockRestore();
    });
  });
});
