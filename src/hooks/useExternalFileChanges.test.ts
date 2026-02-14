/**
 * Tests for file reappearance after deletion in useExternalFileChanges
 *
 * When a deleted file reappears (Finder undo, git checkout, Trash restore),
 * the isMissing flag must be cleared and content reloaded.
 *
 * @module hooks/useExternalFileChanges.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// --- Hoisted mocks ---
const mocks = vi.hoisted(() => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  readTextFile: vi.fn(),
  toastInfo: vi.fn(),
  matchesPendingSave: vi.fn(() => false),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: mocks.readTextFile,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  message: vi.fn(),
  save: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/contexts/WindowContext", () => ({
  useWindowLabel: vi.fn(() => "main"),
}));

vi.mock("@/utils/pendingSaves", () => ({
  matchesPendingSave: mocks.matchesPendingSave,
}));

vi.mock("@/utils/saveToPath", () => ({
  saveToPath: vi.fn(),
}));

import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useExternalFileChanges } from "./useExternalFileChanges";

type ListenCallback = (event: { payload: { watchId: string; rootPath: string; paths: string[]; kind: string } }) => Promise<void>;

function seedStores(overrides: { isMissing?: boolean; lastDiskContent?: string } = {}) {
  useTabStore.setState({
    tabs: {
      main: [{ id: "tab-1", title: "test.md", filePath: "/workspace/test.md", isPinned: false }],
    },
    activeTabId: { main: "tab-1" },
    untitledCounter: 0,
    closedTabs: {},
  });

  useDocumentStore.setState({
    documents: {
      "tab-1": {
        content: "# old content",
        savedContent: "# old content",
        lastDiskContent: overrides.lastDiskContent ?? "# old content",
        filePath: "/workspace/test.md",
        isDirty: false,
        documentId: 0,
        cursorInfo: null,
        lastAutoSave: null,
        isMissing: overrides.isMissing ?? false,
        isDivergent: false,
        lineEnding: "unknown",
        hardBreakStyle: "unknown",
      },
    },
  });
}

/** Extract the callback registered via listen("fs:changed", cb) */
function captureListenCallback(): ListenCallback {
  const calls = mocks.listen.mock.calls as unknown as unknown[][];
  const call = calls.find((c) => c[0] === "fs:changed");
  if (!call) throw new Error("listen('fs:changed') was not called");
  return call[1] as ListenCallback;
}

describe("useExternalFileChanges — file reappearance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears isMissing and reloads when a deleted file reappears with same content", async () => {
    seedStores({ isMissing: true, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# old content");

    renderHook(() => useExternalFileChanges());
    // Wait for async listen setup
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    const callback = captureListenCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(mocks.toastInfo).toHaveBeenCalledWith("Restored: test.md");
  });

  it("clears isMissing and reloads when a deleted file reappears with different content", async () => {
    seedStores({ isMissing: true, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# new content from git");

    renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    const callback = captureListenCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(false);
    expect(doc?.lastDiskContent).toBe("# new content from git");
    expect(mocks.toastInfo).toHaveBeenCalledWith("Restored: test.md");
  });

  it("skips reappearance logic when pending save matches (our own write)", async () => {
    seedStores({ isMissing: true });
    mocks.readTextFile.mockResolvedValue("# old content");
    mocks.matchesPendingSave.mockReturnValue(true);

    renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    const callback = captureListenCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "create",
      },
    });

    // isMissing should NOT have been cleared — it was our own save
    const doc = useDocumentStore.getState().documents["tab-1"];
    expect(doc?.isMissing).toBe(true);
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });

  it("does not trigger reappearance logic for non-missing files with same content", async () => {
    seedStores({ isMissing: false, lastDiskContent: "# old content" });
    mocks.readTextFile.mockResolvedValue("# old content");

    renderHook(() => useExternalFileChanges());
    await vi.waitFor(() => expect(mocks.listen).toHaveBeenCalled());

    const callback = captureListenCallback();

    await callback({
      payload: {
        watchId: "main",
        rootPath: "/workspace",
        paths: ["/workspace/test.md"],
        kind: "modify",
      },
    });

    // Should hit the lastDiskContent check and skip — no toast
    expect(mocks.toastInfo).not.toHaveBeenCalled();
  });
});
