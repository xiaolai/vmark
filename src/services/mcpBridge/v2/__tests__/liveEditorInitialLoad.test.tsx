// An MCP load into the live WYSIWYG editor in the frames before its deferred
// initial load has run. The production flusher writes nothing then (the editor
// holds its empty placeholder), so a load that "took" the content could not
// bring the store to the editor's serialization: it reported success with the
// store and the editor disagreeing. The load must say the editor did not take
// the content, leave the editor alone, and let the editor's own initial load
// and content sync bring it to the store's text.
//
// The REAL editor component is mounted (production extensions and flusher);
// only `@tauri-apps/*` and the window label are mocked.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import type { Editor } from "@tiptap/core";

vi.mock("@tauri-apps/plugin-fs", async () =>
  (await import("./bridgeWriteGate")).gatedFsModule(),
);
vi.mock("@tauri-apps/api/core", async () =>
  (await import("./bridgeWriteGate")).gatedCoreModule(),
);
vi.mock("@/contexts/WindowContext", () => ({ useWindowLabel: () => "main" }));

import { ROOT, doc, openDocInTab } from "@/test/tier0/harness";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { TiptapEditorInner } from "@/components/Editor/TiptapEditor";
import { loadIntoLiveWysiwyg } from "@/services/mcpBridge/v2/liveEditor";
import { resetBridge } from "./bridgeDiskHarness";

const DOC = `${ROOT}/notes.md`;
const ORIGINAL = "# Title\n\nbody\n";
/** Text the editor re-serializes differently (`*` bullets), so a mismatch shows. */
const CLIENT_TEXT = "* one\n* two";

function editorMarkdown(editor: Editor): string {
  return serializeMarkdown(editor.schema, editor.state.doc, getSerializeOptions());
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
  resetBridge();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("a load into the live editor before its initial load has run", () => {
  it("reports the editor did not take it, and the editor then catches up with the store", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    render(<TiptapEditorInner />);
    // No timers advanced: the deferred initial load is still pending.
    const editor = useEditorStore.getState().tiptap.editor;
    if (!editor) throw new Error("the WYSIWYG editor did not register itself");
    expect(useEditorStore.getState().active.activeWysiwygTabId).toBe(tabId);
    const placeholder = editor.state.doc;

    // The caller puts the client's text in the store first, as document.write does.
    useDocumentStore.getState().setEditorContent(tabId, CLIENT_TEXT);
    const loaded = loadIntoLiveWysiwyg(tabId, CLIENT_TEXT);

    expect(loaded).toBe(false);
    expect(editor.state.doc).toBe(placeholder);
    expect(doc(tabId).content).toBe(CLIENT_TEXT);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(doc(tabId).content).toBe(CLIENT_TEXT);
    // The editor's own initial load and content sync bring it to the store's text.
    expect(editor.getText()).toContain("two");
    expect(editor.getText()).not.toContain("Title");
  });

  it("after the initial load, the same load is taken and the store holds the editor's serialization", async () => {
    const tabId = await openDocInTab(DOC, ORIGINAL);
    render(<TiptapEditorInner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    const editor = useEditorStore.getState().tiptap.editor;
    if (!editor) throw new Error("the WYSIWYG editor did not register itself");

    useDocumentStore.getState().setEditorContent(tabId, CLIENT_TEXT);
    expect(loadIntoLiveWysiwyg(tabId, CLIENT_TEXT)).toBe(true);
    expect(doc(tabId).content).toBe(editorMarkdown(editor));
  });
});
