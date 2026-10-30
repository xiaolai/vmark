// @vitest-environment node
/**
 * Tests for toggleMarkdownSplitWithCheckpoint.
 *
 * The flush of pending WYSIWYG edits needs a live editor and is mocked; the
 * UI, tab, document and unified-history stores run for real. Covers: pending
 * edits are flushed BEFORE the checkpoint is read, the checkpoint records the
 * document and the mode being left, a window with no document still toggles,
 * and the toggle flips back.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const order: string[] = [];
vi.mock("@/services/assembly/modeSwitchCleanup", () => ({
  cleanupBeforeModeSwitch: vi.fn(() => order.push("flush")),
}));

import { toggleMarkdownSplitWithCheckpoint } from "./markdownSplitToggle";
import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore, useUnifiedHistoryStore } from "@/stores/documentStore";
import { cleanupBeforeModeSwitch } from "@/services/assembly/modeSwitchCleanup";

function openMarkdown(tabId: string, content: string): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: tabId, filePath: `/w/${tabId}.md`, title: tabId, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: tabId },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(tabId, content, `/w/${tabId}.md`);
}

function undoStack(tabId: string) {
  return useUnifiedHistoryStore.getState().documents[tabId]?.undoStack ?? [];
}

beforeEach(() => {
  order.length = 0;
  vi.clearAllMocks();
  useUIStore.setState({ sourceMode: false, markdownSplitView: false });
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  useUnifiedHistoryStore.setState({ documents: {} });
});

describe("toggleMarkdownSplitWithCheckpoint", () => {
  it("flushes pending edits before snapshotting, then opens the split", () => {
    openMarkdown("t1", "# saved");
    vi.mocked(cleanupBeforeModeSwitch).mockImplementationOnce(() => {
      order.push("flush");
      useDocumentStore.getState().setEditorContent("t1", "# flushed edit");
      return undefined as never;
    });

    toggleMarkdownSplitWithCheckpoint("main");

    expect(order).toEqual(["flush"]);
    expect(undoStack("t1").map((c) => c.markdown)).toEqual(["# flushed edit"]);
    expect(useUIStore.getState().markdownSplitView).toBe(true);
  });

  it("records the mode being LEFT: wysiwyg on open, source on close", () => {
    openMarkdown("t1", "body");

    toggleMarkdownSplitWithCheckpoint("main");
    useDocumentStore.getState().setEditorContent("t1", "body edited in split");
    toggleMarkdownSplitWithCheckpoint("main");

    expect(undoStack("t1").map((c) => c.mode)).toEqual(["wysiwyg", "source"]);
    expect(useUIStore.getState().markdownSplitView).toBe(false);
  });

  it("still toggles when the window has no active document", () => {
    toggleMarkdownSplitWithCheckpoint("main");

    expect(cleanupBeforeModeSwitch).toHaveBeenCalledTimes(1);
    expect(useUnifiedHistoryStore.getState().documents).toEqual({});
    expect(useUIStore.getState().markdownSplitView).toBe(true);
  });

  it("leaves source mode when opening the split", () => {
    openMarkdown("t1", "body");
    useUIStore.setState({ sourceMode: true });

    toggleMarkdownSplitWithCheckpoint("main");

    expect(undoStack("t1")[0]?.mode).toBe("source");
    expect(useUIStore.getState()).toMatchObject({ sourceMode: false, markdownSplitView: true });
  });
});
