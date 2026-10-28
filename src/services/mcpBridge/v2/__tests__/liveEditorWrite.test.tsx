// WI-RA1A.3 — an MCP write into the tab the live WYSIWYG editor is showing
// must leave the document as the reply describes it: clean when it reports
// `saved: true`, at the revision it returns, and accepting that revision next.
//
// The REAL editor component is mounted here (production extensions, the real
// flush machinery and revision tracker), over the real stores, bridge handlers
// and save pipeline; only `@tauri-apps/*` and the window label are mocked. The
// defect lived in the seam between the handler and the mounted editor, which a
// handler test with a stand-in editor cannot see:
//   - the handler's transaction looked like typing, so the editor scheduled a
//     flush that wrote its own re-serialization back as a user edit — dirty
//     again, and a new revision, one frame after "saved";
//   - the store update made the editor reload the same content, and the
//     revision tracker counts every document transaction — so the revision
//     in the reply was already stale when it was sent.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/core";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);
// The real provider boots window services (workspaces, tab transfer).
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

import { statefulFs } from "@/test/statefulFsFake";
import { ROOT, doc, openDocInTab } from "@/test/tier0/harness";
import { useEditorStore } from "@/stores/editorStore";
import { useRevisionStore } from "@/stores/documentStore";
import { agentJournalFake } from "@/test/agentJournalFake";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { TiptapEditorInner } from "@/components/Editor/TiptapEditor";
import { handleDocumentRead, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { handleSelectionGet, handleSelectionSet } from "@/services/mcpBridge/v2/selection";
import { handleWorkspaceSave } from "@/services/mcpBridge/v2/workspaceSave";
import { resetBridge, responseTo, structuredErrorOf } from "./bridgeDiskHarness";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const DOC = `${ROOT}/notes.md`;
/** Markdown the editor re-serializes differently: `*` bullets, `_`/`__` marks. */
const ORIGINAL = "# Title\n\n* one\n* two\n\n_em_\n";
const CLIENT_TEXT = "# Title\n\n* one\n* two\n* three\n\n_em_ and __strong__\n";

interface WriteData {
  revision: string;
  saved: boolean;
  save_skipped?: string;
  save_error?: string;
}

const currentRevision = (tabId: string) => useRevisionStore.getState().getRevision(tabId);

function writeData(id: string): WriteData {
  const r = responseTo(id);
  expect(r.success).toBe(true);
  return r.data as WriteData;
}

/** What the mounted editor currently shows, as markdown. */
function editorMarkdown(editor: Editor): string {
  return serializeMarkdown(editor.schema, editor.state.doc, getSerializeOptions());
}

/** Let every pending frame, debounce and deferred parse run. */
async function settleEditor(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
}

/** Open `content` at DOC and mount the production editor on it. */
async function openInLiveEditor(content: string): Promise<{ tabId: string; editor: Editor }> {
  const tabId = await openDocInTab(DOC, content);
  render(<TiptapEditorInner />);
  await settleEditor();
  const editor = useEditorStore.getState().tiptap.editor;
  if (!editor) throw new Error("the WYSIWYG editor did not register itself");
  expect(useEditorStore.getState().active.activeWysiwygTabId).toBe(tabId);
  return { tabId, editor };
}

/**
 * jsdom has no layout, and it does not define these on Range at all. The
 * editor's scroll-into-view (undo, selection changes) only needs them to exist.
 */
const LAYOUT_STUBS: Array<[object, string, () => unknown]> = [
  [Range.prototype, "getClientRects", () => []],
  [Range.prototype, "getBoundingClientRect", () => new DOMRect()],
];

function installLayoutStubs(): void {
  for (const [target, name, value] of LAYOUT_STUBS) {
    if (name in target) throw new Error(`jsdom now defines ${name}; drop this stub`);
    Object.defineProperty(target, name, { configurable: true, value });
  }
}

function removeLayoutStubs(): void {
  for (const [target, name] of LAYOUT_STUBS) Reflect.deleteProperty(target, name);
}

/** Type at the end of the document, the way a keystroke reaches the editor. */
function typeAtEnd(editor: Editor, text: string): void {
  act(() => {
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, text);
  });
}

beforeEach(() => {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "requestAnimationFrame",
      "cancelAnimationFrame",
    ],
  });
  resetBridge();
  installLayoutStubs();
});

afterEach(() => {
  cleanup();
  removeLayoutStubs();
  vi.useRealTimers();
});

describe("document.write into the live WYSIWYG tab", () => {
  it("reports saved and the document stays clean, frame after frame", async () => {
    const { tabId } = await openInLiveEditor(ORIGINAL);

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: CLIENT_TEXT }, TEST_WRITE_CONTEXT);
    });

    expect(writeData("req-w").saved).toBe(true);
    expect(doc(tabId).isDirty).toBe(false);

    await settleEditor();

    expect(doc(tabId).isDirty).toBe(false);
  });

  it("returns the revision the document is at, and it is still current after the editor settles", async () => {
    const { tabId } = await openInLiveEditor(ORIGINAL);

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: CLIENT_TEXT }, TEST_WRITE_CONTEXT);
    });

    const { revision } = writeData("req-w");
    expect(currentRevision(tabId)).toBe(revision);

    await settleEditor();

    expect(currentRevision(tabId)).toBe(revision);
  });

  it("accepts the next write that presents the returned revision", async () => {
    const { tabId } = await openInLiveEditor(ORIGINAL);
    await act(async () => {
      await handleDocumentWrite("req-1", { tabId, content: CLIENT_TEXT }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();

    await act(async () => {
      await handleDocumentWrite("req-2", {
        tabId,
        content: "# Second\n\nbody\n",
        expected_revision: writeData("req-1").revision,
      }, TEST_WRITE_CONTEXT);
    });

    expect(structuredErrorOf(responseTo("req-2"))).toBeNull();
    expect(writeData("req-2").saved).toBe(true);
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("disk, buffer and editor hold the same text", async () => {
    const { tabId, editor } = await openInLiveEditor(ORIGINAL);

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: CLIENT_TEXT }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();

    const buffer = doc(tabId).content;
    expect(statefulFs.read(DOC)).toBe(buffer);
    expect(editorMarkdown(editor)).toBe(buffer);
    expect(doc(tabId).savedContent).toBe(buffer);
    // Nothing of the client's content was lost on the way.
    expect(buffer).toContain("three");
    expect(buffer).toContain("strong");
  });

  it("keeps the file's CRLF line endings and BOM", async () => {
    const { tabId } = await openInLiveEditor("\u{FEFF}first\r\n\r\nsecond\r\n");

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: "first\n\nsecond\n\nthird\n" }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();

    expect(statefulFs.read(DOC)).toBe("\u{FEFF}first\r\n\r\nsecond\r\n\r\nthird\r\n");
    expect(doc(tabId).isDirty).toBe(false);
  });

  it("save:false leaves the document dirty, at a revision that stays current", async () => {
    const { tabId } = await openInLiveEditor(ORIGINAL);

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: CLIENT_TEXT, save: false }, TEST_WRITE_CONTEXT);
    });
    const data = writeData("req-w");
    await settleEditor();

    expect(data).toMatchObject({ saved: false, save_skipped: "opt_out" });
    expect(doc(tabId).isDirty).toBe(true);
    expect(statefulFs.read(DOC)).toBe(ORIGINAL);
    expect(currentRevision(tabId)).toBe(data.revision);
  });

  it("can be undone in the editor", async () => {
    const { tabId, editor } = await openInLiveEditor(ORIGINAL);
    const before = editorMarkdown(editor);

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: CLIENT_TEXT }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();
    expect(editorMarkdown(editor)).not.toBe(before);

    act(() => {
      editor.commands.undo();
    });
    await settleEditor();

    expect(editorMarkdown(editor)).toBe(before);
    // Undoing is the user's edit: the buffer follows and differs from disk.
    expect(doc(tabId).content).toBe(before);
    expect(doc(tabId).isDirty).toBe(true);
  });
});

describe("keystrokes the editor has not flushed yet", () => {
  it("make a revision read before them STALE, instead of being overwritten", async () => {
    const { tabId, editor } = await openInLiveEditor("hello\n");
    const revisionBeforeTyping = currentRevision(tabId);

    typeAtEnd(editor, " world");
    await act(async () => {
      await handleDocumentWrite("req-w", {
        tabId,
        content: "replaced\n",
        expected_revision: revisionBeforeTyping,
      }, TEST_WRITE_CONTEXT);
    });

    expect(structuredErrorOf(responseTo("req-w"))?.error).toBe("STALE");
    await settleEditor();
    expect(doc(tabId).content).toBe("hello world\n");
  });

  it("are in the journaled preimage a blind write replaces, and do not re-dirty it", async () => {
    const { tabId, editor } = await openInLiveEditor("hello\n");

    typeAtEnd(editor, " world");
    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: "replaced\n" }, TEST_WRITE_CONTEXT);
    });
    const { revision } = writeData("req-w");
    await settleEditor();

    // The user's unflushed typing is recoverable, not silently discarded.
    expect(agentJournalFake.prepareControlledWrite).toHaveBeenCalledWith(
      expect.objectContaining({ docKey: `path:${DOC}`, preimage: "hello world\n" }),
    );
    expect(doc(tabId).content).toBe("replaced\n");
    expect(doc(tabId).isDirty).toBe(false);
    expect(currentRevision(tabId)).toBe(revision);
  });

  it("are returned by document.read", async () => {
    const { tabId, editor } = await openInLiveEditor("hello\n");

    typeAtEnd(editor, " world");
    await act(async () => {
      await handleDocumentRead("req-r", { tabId }, TEST_WRITE_CONTEXT);
    });

    const data = responseTo("req-r").data as { content: string; revision: string; dirty: boolean };
    expect(data.content).toBe("hello world\n");
    expect(data.dirty).toBe(true);
    expect(data.revision).toBe(currentRevision(tabId));
    await settleEditor();
    expect(currentRevision(tabId)).toBe(data.revision);
  });

  it("do not make the revision selection.get returns go stale when they flush", async () => {
    // The keystroke bumps the revision once when typed and once more when the
    // debounced flush reaches the store. A revision read in between — which
    // selection.get did, not flushing first — was stale a frame later with no
    // further edit, so the selection.set built on it was refused.
    const { tabId, editor } = await openInLiveEditor("hello\n");

    typeAtEnd(editor, " world");
    await act(async () => {
      await handleSelectionGet("req-g", {});
    });
    const data = responseTo("req-g").data as { revision: string };
    await settleEditor();

    expect(currentRevision(tabId)).toBe(data.revision);
    await act(async () => {
      await handleSelectionSet("req-s", { content: "!", expected_revision: data.revision }, TEST_WRITE_CONTEXT);
    });
    expect(structuredErrorOf(responseTo("req-s"))).toBeNull();
  });

  it("are saved by workspace.save, which leaves the document clean", async () => {
    const { tabId, editor } = await openInLiveEditor("hello\n");

    typeAtEnd(editor, " world");
    await act(async () => {
      await handleWorkspaceSave("req-s", { tabId }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();

    expect(responseTo("req-s").success).toBe(true);
    expect(statefulFs.read(DOC)).toBe("hello world\n");
    expect(doc(tabId).isDirty).toBe(false);
  });
});

describe("selection.set into the live WYSIWYG tab", () => {
  it("returns a revision that is still current after the editor settles", async () => {
    const { tabId, editor } = await openInLiveEditor("hello world\n");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });

    await act(async () => {
      await handleSelectionSet("req-sel", { content: "HELLO" }, TEST_WRITE_CONTEXT);
    });
    const data = responseTo("req-sel").data as { revision: string; replaced_chars: number };

    expect(data.replaced_chars).toBe(5);
    expect(currentRevision(tabId)).toBe(data.revision);
    await settleEditor();
    expect(currentRevision(tabId)).toBe(data.revision);
    expect(doc(tabId).content).toBe("HELLO world\n");
    expect(doc(tabId).isDirty).toBe(true);
  });

  it("accepts a document.write that presents the returned revision", async () => {
    const { tabId, editor } = await openInLiveEditor("hello world\n");
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await act(async () => {
      await handleSelectionSet("req-sel", { content: "HELLO" }, TEST_WRITE_CONTEXT);
    });
    await settleEditor();
    const { revision } = responseTo("req-sel").data as { revision: string };

    await act(async () => {
      await handleDocumentWrite("req-w", { tabId, content: "done\n", expected_revision: revision }, TEST_WRITE_CONTEXT);
    });

    expect(structuredErrorOf(responseTo("req-w"))).toBeNull();
    expect(statefulFs.read(DOC)).toBe("done\n");
  });
});
