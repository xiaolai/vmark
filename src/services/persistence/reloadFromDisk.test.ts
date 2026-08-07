// @vitest-environment node
/**
 * Tests for reloadTabFromDisk.
 *
 * Shared helper used by useExternalFileChanges (auto-reload, user-confirmed
 * reload) and the MCP workspaceHandlers (workspace.reloadDocument). A
 * regression here corrupts both paths plus the linebreak-preservation
 * contract on subsequent saves.
 *
 * The REAL documentStore is exercised (only the filesystem is mocked), so
 * these tests assert final document state — canonical content, derived line
 * metadata, cleared missing flag — and catch integration drift between
 * reloadFromDisk and the disk-open ingest door.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockReadTextFile } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));

import { reloadTabFromDisk } from "./reloadFromDisk";
import { useDocumentStore } from "@/stores/documentStore";

beforeEach(() => {
  mockReadTextFile.mockReset();
  Object.keys(useDocumentStore.getState().documents).forEach((id) =>
    useDocumentStore.getState().removeDocument(id)
  );
});

describe("reloadTabFromDisk", () => {
  it("loads content and clears missing flag on success", async () => {
    // Pre-reload state: the doc exists, holds stale content, and is flagged
    // missing (the file-watcher path that triggers a reload).
    useDocumentStore.getState().initDocument("tab-1", "stale", "/x/file.md");
    useDocumentStore.getState().markMissing("tab-1");
    mockReadTextFile.mockResolvedValueOnce("hello\nworld\n");

    await reloadTabFromDisk("tab-1", "/x/file.md");

    expect(mockReadTextFile).toHaveBeenCalledWith("/x/file.md");
    const doc = useDocumentStore.getState().getDocument("tab-1");
    expect(doc?.content).toBe("hello\nworld\n");
    expect(doc?.filePath).toBe("/x/file.md");
    expect(doc?.lineEnding).toBe("lf");
    expect(doc?.isDirty).toBe(false);
    expect(doc?.isMissing).toBe(false);
  });

  it("detects CRLF when file uses Windows line endings", async () => {
    mockReadTextFile.mockResolvedValueOnce("a\r\nb\r\n");
    await reloadTabFromDisk("tab-crlf", "/x/win.md");
    const doc = useDocumentStore.getState().getDocument("tab-crlf");
    // Canonical LF in the editor; the file's CRLF convention is recorded so a
    // subsequent "preserve" save can round-trip it.
    expect(doc?.content).toBe("a\nb\n");
    expect(doc?.lineEnding).toBe("crlf");
    expect(doc?.lastDiskContent).toBe("a\r\nb\r\n");
  });

  it("records lineEnding=unknown for content without any line break", async () => {
    mockReadTextFile.mockResolvedValueOnce("single line");
    await reloadTabFromDisk("tab-x", "/x/nonl.md");
    const doc = useDocumentStore.getState().getDocument("tab-x");
    expect(doc?.content).toBe("single line");
    expect(doc?.lineEnding).toBe("unknown");
  });

  it("handles empty file content", async () => {
    mockReadTextFile.mockResolvedValueOnce("");
    await reloadTabFromDisk("tab-empty", "/x/empty.md");
    const doc = useDocumentStore.getState().getDocument("tab-empty");
    expect(doc?.content).toBe("");
    expect(doc?.lineEnding).toBe("unknown");
    expect(doc?.isMissing).toBe(false);
  });

  it("propagates readTextFile error and does NOT mutate store", async () => {
    useDocumentStore.getState().initDocument("tab-err", "keep me", "/gone.md");
    useDocumentStore.getState().markMissing("tab-err");
    mockReadTextFile.mockRejectedValueOnce(new Error("ENOENT"));

    await expect(reloadTabFromDisk("tab-err", "/gone.md")).rejects.toThrow("ENOENT");

    const doc = useDocumentStore.getState().getDocument("tab-err");
    expect(doc?.content).toBe("keep me");
    expect(doc?.isMissing).toBe(true);
  });
});
