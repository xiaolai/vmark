/**
 * Tests for reloadTabFromDisk.
 *
 * Shared helper used by useExternalFileChanges (auto-reload, user-confirmed
 * reload) and the MCP workspaceHandlers (workspace.reloadDocument). A
 * regression here corrupts both paths plus the linebreak-preservation
 * contract on subsequent saves.
 *
 * detectLinebreaks is exercised for real (not mocked) so this also catches
 * integration drift between reloadFromDisk and linebreakDetection.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockReadTextFile, mockLoadContent, mockClearMissing } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn(),
  mockLoadContent: vi.fn(),
  mockClearMissing: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({
      loadContent: mockLoadContent,
      clearMissing: mockClearMissing,
    }),
  },
}));

import { reloadTabFromDisk } from "./reloadFromDisk";

beforeEach(() => {
  mockReadTextFile.mockReset();
  mockLoadContent.mockReset();
  mockClearMissing.mockReset();
});

describe("reloadTabFromDisk", () => {
  it("loads content and clears missing flag on success", async () => {
    mockReadTextFile.mockResolvedValueOnce("hello\nworld\n");

    await reloadTabFromDisk("tab-1", "/x/file.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/x/file.md");
    expect(mockLoadContent).toHaveBeenCalledTimes(1);
    const [tabId, content, path, detection] = mockLoadContent.mock.calls[0];
    expect(tabId).toBe("tab-1");
    expect(content).toBe("hello\nworld\n");
    expect(path).toBe("/x/file.md");
    expect(detection.lineEnding).toBe("lf");
    expect(mockClearMissing).toHaveBeenCalledWith("tab-1");
  });

  it("detects CRLF when file uses Windows line endings", async () => {
    mockReadTextFile.mockResolvedValueOnce("a\r\nb\r\n");
    await reloadTabFromDisk("tab-crlf", "/x/win.md");
    const detection = mockLoadContent.mock.calls[0][3];
    expect(detection.lineEnding).toBe("crlf");
  });

  it("returns lineEnding=unknown for content without any line break", async () => {
    mockReadTextFile.mockResolvedValueOnce("single line");
    await reloadTabFromDisk("tab-x", "/x/nonl.md");
    const detection = mockLoadContent.mock.calls[0][3];
    expect(detection.lineEnding).toBe("unknown");
  });

  it("handles empty file content", async () => {
    mockReadTextFile.mockResolvedValueOnce("");
    await reloadTabFromDisk("tab-empty", "/x/empty.md");
    expect(mockLoadContent).toHaveBeenCalledTimes(1);
    const [, content, , detection] = mockLoadContent.mock.calls[0];
    expect(content).toBe("");
    expect(detection.lineEnding).toBe("unknown");
    expect(mockClearMissing).toHaveBeenCalledWith("tab-empty");
  });

  it("propagates readTextFile error and does NOT mutate store", async () => {
    mockReadTextFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(reloadTabFromDisk("tab-err", "/gone.md")).rejects.toThrow("ENOENT");
    expect(mockLoadContent).not.toHaveBeenCalled();
    expect(mockClearMissing).not.toHaveBeenCalled();
  });
});
