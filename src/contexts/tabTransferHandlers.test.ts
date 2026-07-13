/**
 * Destination-side tab-transfer handlers.
 *
 * The critical contract under test: `prepare` reports the tab's LIVE state and
 * destroys nothing; `commit` removes the tab and acknowledges it. A destination
 * that cannot honor the request must refuse (accepted: false) rather than let
 * the source restore a stale snapshot over the user's newer edits.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { TabRemovalAck } from "@/types/tabTransfer";

const { mockEmit } = vi.hoisted(() => ({ mockEmit: vi.fn(() => Promise.resolve()) }));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "doc-2", emit: mockEmit }),
}));

const mockGetTabsByWindow = vi.fn();
const mockDetachTab = vi.fn();
const mockGetDocument = vi.fn();
const mockCreateTransferredTab = vi.fn(() => "tab-created");
const mockUpdateTabTitle = vi.fn();
const mockInitDocument = vi.fn();
const mockAddFile = vi.fn();

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      getTabsByWindow: mockGetTabsByWindow,
      detachTab: mockDetachTab,
      createTransferredTab: mockCreateTransferredTab,
      updateTabTitle: mockUpdateTabTitle,
    }),
  },
}));

vi.mock("@/stores/documentStore", () => ({
  useDocumentStore: {
    getState: () => ({ getDocument: mockGetDocument, initDocument: mockInitDocument }),
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: { getState: () => ({ rootPath: "/ws" }) },
  useRecentFilesStore: { getState: () => ({ addFile: mockAddFile }) },
}));

vi.mock("@/hooks/tabCleanup", () => ({ cleanupTabState: vi.fn() }));
vi.mock("@/utils/debug", () => ({
  windowCloseWarn: vi.fn(),
  windowContextError: vi.fn(),
}));
vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/utils/openPolicy", () => ({
  resolveWorkspaceRootForExternalFile: vi.fn(() => null),
}));

const mockInvoke = vi.mocked(invoke);

/** Read the ack the handler emitted back to Rust. */
function emittedAck(): TabRemovalAck {
  const call = mockEmit.mock.calls.find((c) => c[0] === "tab:remove-ack");
  expect(call, "handler must acknowledge every removal request").toBeDefined();
  return (call as unknown as [string, TabRemovalAck])[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTabsByWindow.mockReturnValue([
    { kind: "document", id: "tab-1", title: "Doc 1", filePath: "/f.md", isPinned: false },
    { kind: "document", id: "tab-2", title: "Doc 2", filePath: "/g.md", isPinned: false },
  ]);
  // The destination has edited the document since the transfer landed.
  mockGetDocument.mockReturnValue({
    content: "# Edited in destination",
    savedContent: "# Original",
    isDirty: true,
  });
  mockInvoke.mockResolvedValue(undefined);
});

describe("handleTabRemovalRequest — prepare", () => {
  it("acks with the destination's LIVE content, not the pre-transfer snapshot", async () => {
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-1",
      tabId: "tab-1",
      phase: "prepare",
    });

    const ack = emittedAck();
    expect(ack.accepted).toBe(true);
    expect(ack.requestId).toBe("req-1");
    expect(ack.data).toEqual({
      tabId: "tab-1",
      title: "Doc 1",
      filePath: "/f.md",
      content: "# Edited in destination",
      savedContent: "# Original",
      isDirty: true,
      workspaceRoot: "/ws",
    });
  });

  it("destroys nothing — prepare must not remove the tab", async () => {
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-1",
      tabId: "tab-1",
      phase: "prepare",
    });

    expect(mockDetachTab).not.toHaveBeenCalled();
    expect(mockInvoke).not.toHaveBeenCalledWith("close_window", expect.anything());
  });

  it("refuses when the tab is no longer in this window", async () => {
    mockGetTabsByWindow.mockReturnValue([]);
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-1",
      tabId: "tab-1",
      phase: "prepare",
    });

    const ack = emittedAck();
    expect(ack.accepted).toBe(false);
    expect(ack.reason).toBe("tabNotFound");
    expect(ack.data).toBeUndefined();
    expect(mockDetachTab).not.toHaveBeenCalled();
  });

  it("refuses when the document behind the tab is gone", async () => {
    mockGetDocument.mockReturnValue(null);
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-1",
      tabId: "tab-1",
      phase: "prepare",
    });

    const ack = emittedAck();
    expect(ack.accepted).toBe(false);
    expect(ack.reason).toBe("documentNotFound");
    expect(mockDetachTab).not.toHaveBeenCalled();
  });
});

describe("handleTabRemovalRequest — commit", () => {
  it("removes the tab and acknowledges the removal", async () => {
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-2",
      tabId: "tab-1",
      phase: "commit",
    });

    expect(mockDetachTab).toHaveBeenCalledWith("doc-2", "tab-1");
    const ack = emittedAck();
    expect(ack.accepted).toBe(true);
    expect(ack.phase).toBe("commit");
  });

  it("acknowledges before the window closes itself", async () => {
    // The auto-close of an emptied doc window must not race the ack — the source
    // is blocked on it.
    mockGetTabsByWindow.mockReturnValue([]); // no tabs left after the removal

    const order: string[] = [];
    mockEmit.mockImplementation((event: string) => {
      order.push(`emit:${event}`);
      return Promise.resolve();
    });
    mockInvoke.mockImplementation((cmd: string) => {
      order.push(`invoke:${cmd}`);
      return Promise.resolve(undefined);
    });

    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-2",
      tabId: "tab-1",
      phase: "commit",
    });

    expect(order).toEqual(["emit:tab:remove-ack", "invoke:close_window"]);
  });

  it("refuses an unknown phase instead of removing the tab", async () => {
    // Zero trust at the boundary: a malformed payload must never fall through
    // to the destructive branch.
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-3",
      tabId: "tab-1",
      phase: "delete" as unknown as "commit",
    });

    expect(mockDetachTab).not.toHaveBeenCalled();
    const ack = emittedAck();
    expect(ack.accepted).toBe(false);
    expect(ack.reason).toBe("unknownPhase");
  });

  it("is idempotent — committing an already-removed tab still acks", async () => {
    mockGetTabsByWindow.mockReturnValue([]);
    const { handleTabRemovalRequest } = await import("./tabTransferHandlers");
    await handleTabRemovalRequest("doc-2", {
      requestId: "req-2",
      tabId: "gone",
      phase: "commit",
    });

    expect(emittedAck().accepted).toBe(true);
  });
});
