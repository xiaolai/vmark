/**
 * `loadFileIntoTab` must not resurrect a tab that closed while its read was in
 * flight.
 *
 * `fileOpen.ts` has re-checked the tab after its await since WI-0.2 (C1).
 * Finder-open is a copy of that flow that drifted from it, and the copy wrote
 * unconditionally: close the tab during `readTextFile` and the ingest recreated
 * a document entry for a tab ID nothing owned any more — an orphan the store
 * would then carry until the window closed.
 *
 * The existing Finder suites cannot catch this. Their tabStore mocks return a
 * tab for every ID, so the guard's FALSE branch is never taken and the
 * regression this file exists to pin would pass there unnoticed. That is the
 * whole reason it is a separate file rather than two more cases over there.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — loadFileIntoTab
 * @coordinates-with services/navigation/fileOpen.ts — the sibling that already had this
 * @module hooks/useFinderFileOpen.closeDuringRead.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockReadTextFile, mockFindTabById, mockAddFile } = vi.hoisted(() => ({
  mockReadTextFile: vi.fn(),
  mockFindTabById: vi.fn(),
  mockAddFile: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: (...args: unknown[]) => mockReadTextFile(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(vi.fn())) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve([])) }));
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));
vi.mock("@/stores/tabStore", () => ({
  useTabStore: { getState: () => ({ findTabById: mockFindTabById }) },
}));
vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ workspaceRoot: null }) },
  useRecentFilesStore: { getState: () => ({ addFile: mockAddFile }) },
}));

import { useDocumentStore } from "@/stores/documentStore";
import { loadFileIntoTab } from "./useFinderFileOpen";

const TAB = "tab-closed-mid-read";
const PATH = "/w/doc.md";

beforeEach(() => {
  useDocumentStore.setState({ documents: {} });
  mockReadTextFile.mockReset().mockResolvedValue("# From disk\n");
  mockFindTabById.mockReset();
  mockAddFile.mockReset();
});

describe("loadFileIntoTab — tab closed while the read was in flight", () => {
  it("writes no document when the tab is gone by the time the read resolves", async () => {
    mockFindTabById.mockReturnValue(null);

    await loadFileIntoTab(TAB, PATH);

    expect(useDocumentStore.getState().documents[TAB]).toBeUndefined();
  });

  it("does not add the file to recents either — nothing was opened", async () => {
    mockFindTabById.mockReturnValue(null);

    await loadFileIntoTab(TAB, PATH);

    expect(mockAddFile).not.toHaveBeenCalled();
  });

  it("re-checks AFTER the await, not before — a tab closed mid-read is still caught", async () => {
    // The guard is worthless if it runs before the read: the close happens
    // DURING the read, so a pre-await check sees a live tab and proceeds.
    let closed = false;
    mockFindTabById.mockImplementation(() => (closed ? null : { id: TAB }));
    mockReadTextFile.mockImplementation(async () => {
      closed = true; // the user closes the tab while the file is being read
      return "# From disk\n";
    });

    await loadFileIntoTab(TAB, PATH);

    expect(useDocumentStore.getState().documents[TAB]).toBeUndefined();
  });

  it("still loads normally when the tab survives the read", async () => {
    mockFindTabById.mockReturnValue({ id: TAB });

    await loadFileIntoTab(TAB, PATH);

    expect(useDocumentStore.getState().documents[TAB]?.content).toBe("# From disk\n");
    expect(mockAddFile).toHaveBeenCalledWith(PATH);
  });

  it("propagates a read failure instead of swallowing it — callers clean up the tab", async () => {
    mockReadTextFile.mockRejectedValue(new Error("EACCES"));
    mockFindTabById.mockReturnValue({ id: TAB });

    await expect(loadFileIntoTab(TAB, PATH)).rejects.toThrow("EACCES");
    expect(useDocumentStore.getState().documents[TAB]).toBeUndefined();
  });
});
