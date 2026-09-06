// @vitest-environment node
/**
 * Audit 20260906 F4 — a new edit did not invalidate checkpoint redo.
 *
 * Split from `unifiedHistory.test.ts` (size gate); the mock setup is repeated
 * because these cases need the same production stack.
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock CodeMirror commands
// Typed with a rest parameter: the stubs below forward the real commands'
// arguments, and a zero-arity mock cannot receive a spread.
const mockUndo = vi.fn((..._args: unknown[]) => true);
const mockRedo = vi.fn((..._args: unknown[]) => true);
const mockUndoDepth = vi.fn((..._args: unknown[]) => 0);
const mockRedoDepth = vi.fn((..._args: unknown[]) => 0);

vi.mock("@codemirror/commands", () => ({
  undo: (...args: unknown[]) => mockUndo(...args),
  redo: (...args: unknown[]) => mockRedo(...args),
  undoDepth: (...args: unknown[]) => mockUndoDepth(...args),
  redoDepth: (...args: unknown[]) => mockRedoDepth(...args),
}));

import { useUnifiedHistoryStore } from "@/stores/documentStore";
import { useUIStore } from "@/stores/uiStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import type { Tab } from "@/stores/tabStoreTypes";
// The production factory, so a document fixture cannot drift from the real
// DocumentState shape.
import { createInitialDocument } from "@/stores/documentStore/documentState";
import { performUnifiedUndo, performUnifiedRedo } from "./unifiedUndoRedo";

/**
 * Audit 20260906 F4 — a new edit did not invalidate checkpoint redo, so Redo
 * overwrote the freshly typed branch.
 *
 * The native editor drops its redo stack on any new edit. The CHECKPOINT stack
 * could not: an ordinary keystroke never reaches the history store, and the
 * store only cleared redo when a new checkpoint was created (a mode switch).
 * So after undoing to a checkpoint and then typing, native redo depth was 0
 * while unified redo still held the pre-undo content — and applying it
 * replaced what the user had just written.
 */
describe("checkpoint redo after a new edit branches history (F4)", () => {
  /** Put the tab at content `A` with one checkpoint holding `A`. */
  function setUp(current: string) {
    useDocumentStore.setState({
      documents: {
        "tab-1": createInitialDocument(current, "/test/doc.md"),
      },
    });
  }

  beforeEach(() => {
    // This block sits outside the file's main describe, so it owns its own
    // reset — the checkpoint stacks otherwise accumulate across these cases.
    useUnifiedHistoryStore.getState().clearAll();
    useUIStore.setState({ sourceMode: false });
    useTabStore.setState({
      tabs: {
        main: [
          {
            id: "tab-1",
            title: "doc",
            kind: "document",
            filePath: "/doc.md",
            formatId: "markdown",
          } as unknown as Tab,
        ],
      },
      activeTabId: { main: "tab-1" },
    });

    // Native history is exhausted in every case here — that is the precondition
    // for the checkpoint stack being consulted at all.
    mockUndoDepth.mockReset().mockReturnValue(0);
    mockRedoDepth.mockReset().mockReturnValue(0);
    mockUndo.mockReset().mockReturnValue(false);
    mockRedo.mockReset().mockReturnValue(false);
  });

  it("refuses a redo whose branch the user has since typed away from", () => {
    setUp("B\n");
    // Checkpoint holds A; the document currently shows B.
    useUnifiedHistoryStore.getState().createCheckpoint("tab-1", {
      markdown: "A\n",
      mode: "wysiwyg",
      cursorInfo: null,
    });

    expect(performUnifiedUndo("main")).toBe(true);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("A\n");

    // The user types C instead of redoing — history branches here.
    setUp("C\n");

    expect(performUnifiedRedo("main")).toBe(false);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("C\n");
  });

  it("discards the abandoned branch rather than leaving it to resurface", () => {
    setUp("B\n");
    useUnifiedHistoryStore.getState().createCheckpoint("tab-1", {
      markdown: "A\n",
      mode: "wysiwyg",
      cursorInfo: null,
    });
    performUnifiedUndo("main");
    setUp("C\n");

    performUnifiedRedo("main");

    expect(
      useUnifiedHistoryStore.getState().documents["tab-1"].redoStack,
    ).toHaveLength(0);
  });

  // The other half of the contract: an untouched redo must still work, or the
  // fix would simply have broken cross-mode redo.
  it("still redoes when no edit intervened", () => {
    setUp("B\n");
    useUnifiedHistoryStore.getState().createCheckpoint("tab-1", {
      markdown: "A\n",
      mode: "wysiwyg",
      cursorInfo: null,
    });

    expect(performUnifiedUndo("main")).toBe(true);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("A\n");

    expect(performUnifiedRedo("main")).toBe(true);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("B\n");
  });

  it("records the branch point the undo left the document on", () => {
    setUp("B\n");
    useUnifiedHistoryStore.getState().createCheckpoint("tab-1", {
      markdown: "A\n",
      mode: "wysiwyg",
      cursorInfo: null,
    });
    performUnifiedUndo("main");

    const top = useUnifiedHistoryStore.getState().documents["tab-1"].redoStack.at(-1);
    expect(top?.branchBase).toBe("A\n");
    expect(top?.markdown).toBe("B\n");
  });

  // An edit that happens to restore the branch content leaves redo usable —
  // the document really is back at the branch point.
  it("permits redo again if the document returns to the branch point", () => {
    setUp("B\n");
    useUnifiedHistoryStore.getState().createCheckpoint("tab-1", {
      markdown: "A\n",
      mode: "wysiwyg",
      cursorInfo: null,
    });
    performUnifiedUndo("main");
    setUp("C\n");
    setUp("A\n");

    expect(performUnifiedRedo("main")).toBe(true);
    expect(useDocumentStore.getState().documents["tab-1"].content).toBe("B\n");
  });

  it("leaves the undo stack alone when it drops a stale redo", () => {
    setUp("B\n");
    const history = useUnifiedHistoryStore.getState();
    history.createCheckpoint("tab-1", { markdown: "A0\n", mode: "wysiwyg", cursorInfo: null });
    history.createCheckpoint("tab-1", { markdown: "A1\n", mode: "wysiwyg", cursorInfo: null });
    performUnifiedUndo("main");
    setUp("C\n");

    performUnifiedRedo("main");

    expect(
      useUnifiedHistoryStore.getState().documents["tab-1"].undoStack,
    ).toHaveLength(1);
  });
});
