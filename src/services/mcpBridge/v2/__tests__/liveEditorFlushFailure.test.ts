// document.write and document.transform into the live WYSIWYG tab when the
// flush after the load FAILS. The editor already holds the new document, so
// the store must be brought to the editor's text before anything is committed
// or reported: a retried flush that succeeds commits the editor's text and
// answers applied-with-error; one that fails again is answered without
// `applied` and commits nothing (the journal keeps the transaction open). The
// failure is never swallowed into a success that reports the client's text.
//
// Real stores, a real Tiptap editor and the real flusher registry; the journal
// IPC client is the in-memory fake installed by the global test hooks.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@/services/mcpBridge/utils", () => ({ respond: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useEditorStore } from "@/stores/editorStore";
import { registerWysiwygFlusher } from "@/utils/wysiwygFlush";
import { markContentApplied } from "@/services/editor/contentApplied";
import { respond } from "@/services/mcpBridge/utils";
import { handleDocumentTransform, handleDocumentWrite } from "@/services/mcpBridge/v2/document";
import { agentJournalFake as fake } from "@/test/agentJournalFake";
import { TEST_WRITE_CONTEXT } from "@/test/mcpAttributionFixture";

const TAB = "w1";
let editor: Editor;
let flushFailures: number;

/** What the editor's flush writes: its own text, newline-terminated (the client's write is not). */
const editorText = () => `${editor.getText()}\n`;

function seedLive(text: string): void {
  useTabStore.setState({
    tabs: { main: [{ kind: "document", id: TAB, filePath: "/notes/a.md", title: TAB, isPinned: false, formatId: "markdown" }] },
    activeTabId: { main: TAB },
    untitledCounter: 0,
  });
  useDocumentStore.getState().initDocument(TAB, `${text}\n`, "/notes/a.md");
  editor = new Editor({ extensions: [StarterKit], content: `<p>${text}</p>` });
  markContentApplied(editor); // its initial load has run
  useEditorStore.getState().setTiptapEditor(editor);
  useEditorStore.getState().setActiveWysiwygEditor(editor, TAB);
  registerWysiwygFlusher(TAB, () => {
    // Only the flush after the load fails: the ones before it (tab resolution,
    // the post-prepare re-verify) find the editor still holding `text`.
    if (flushFailures > 0 && editor.getText() !== text) {
      flushFailures -= 1;
      throw new Error("serializer crashed");
    }
    useDocumentStore.getState().setEditorContent(TAB, editorText());
  });
}

function refusal(requestId: string): Record<string, unknown> {
  const call = vi.mocked(respond).mock.calls.find(([r]) => r.id === requestId);
  if (!call) throw new Error(`no reply for ${requestId}`);
  expect(call[0].success).toBe(false);
  return JSON.parse(call[0].error ?? "null") as Record<string, unknown>;
}

const content = () => useDocumentStore.getState().documents[TAB]?.content;
const commits = () => fake.log.filter((e) => e.op === "commit");

const write = (id: string) => handleDocumentWrite(id, { tabId: TAB, content: "new text", save: false }, TEST_WRITE_CONTEXT);
const transform = (id: string) => handleDocumentTransform(id, { tabId: TAB, kind: "cjk-spacing" }, TEST_WRITE_CONTEXT);

beforeEach(() => {
  vi.clearAllMocks();
  flushFailures = 0;
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
});

afterEach(() => {
  registerWysiwygFlusher(TAB, null);
  useEditorStore.getState().setActiveWysiwygEditor(null);
  useEditorStore.getState().setTiptapEditor(null);
  editor.destroy();
});

describe.each([
  ["document.write", write, "old text", "new text"],
  ["document.transform", transform, "测试ABC混合", "测试 ABC 混合"],
])("%s — the flush after the live load fails", (_tool, run, before, after) => {
  it("once: the retried flush commits the EDITOR's text and answers applied with error", async () => {
    seedLive(before);
    flushFailures = 1;

    await run("r1");

    expect(editor.getText()).toBe(after);
    expect(content()).toBe(editorText());
    expect(commits().map((e) => e.detail)).toEqual([editorText()]);
    expect(refusal("r1")).toMatchObject({ error: "INTERNAL", applied: true });
  });

  it("twice: nothing is committed and the answer does not claim it was applied", async () => {
    seedLive(before);
    flushFailures = 2;

    await run("r2");

    expect(commits()).toEqual([]);
    const answer = refusal("r2");
    expect(answer.error).toBe("INTERNAL");
    expect(answer.applied).toBeUndefined();
  });
});
