// WI-AL1.4 — A content load tells the agent edit journal's WYSIWYG collector what text it loaded, once the editor holds it — at once for a load applied at once, only when it runs for a load that waited behind an IME composition, never for a waiting load that was dropped — and the store→editor sync passes the text it loads.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { flushProseMirrorCompositionQueue, IME_GRACE_PERIOD_MS, markProseMirrorCompositionEnd } from "@/utils/imeGuard";
import { parseMarkdown } from "@/utils/markdownPipeline";

const noted = vi.hoisted(() => [] as { markdown: string; text: string }[]);
vi.mock("@/services/agentJournal/collectors/wysiwyg/wysiwygCollector", () => ({
  noteWysiwygLoaded: (editor: Editor, markdown: string) => noted.push({ markdown, text: editor.state.doc.textContent }),
}));

import { setContentWithoutHistory, syncMarkdownToEditor } from "./tiptapContentLoad";

let editor: Editor;
let composing: ReturnType<typeof vi.spyOn>;
const docOf = (markdown: string) => parseMarkdown(editor.schema, markdown, { preserveLineBreaks: false });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.advanceTimersByTime(10_000);
  editor = new Editor({ extensions: [StarterKit], content: "<p>old</p>" });
  composing = vi.spyOn(editor.view, "composing", "get").mockReturnValue(false);
  noted.length = 0;
});
afterEach(() => {
  editor.destroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function settleComposition() {
  composing.mockReturnValue(false);
  markProseMirrorCompositionEnd(editor.view);
  flushProseMirrorCompositionQueue(editor.view);
  vi.advanceTimersByTime(IME_GRACE_PERIOD_MS + 1);
  flushProseMirrorCompositionQueue(editor.view);
}

describe("content loads and the agent edit journal", () => {
  it("notes a load applied at once, after the editor holds it", () => {
    setContentWithoutHistory(editor, docOf("new"), () => true, "new");
    expect(noted).toEqual([{ markdown: "new", text: "new" }]);
  });

  it("notes nothing when the caller has no text for the load", () => {
    setContentWithoutHistory(editor, docOf("new"));
    expect(noted).toEqual([]);
  });

  it("notes a waiting load only when it runs", () => {
    composing.mockReturnValue(true);
    expect(setContentWithoutHistory(editor, docOf("later"), () => true, "later")).toBe("deferred");
    expect(noted).toEqual([]);
    settleComposition();
    expect(noted).toEqual([{ markdown: "later", text: "later" }]);
  });

  it("never notes a waiting load that was dropped", () => {
    composing.mockReturnValue(true);
    setContentWithoutHistory(editor, docOf("stale"), () => false, "stale");
    settleComposition();
    expect(editor.state.doc.textContent).toBe("old");
    expect(noted).toEqual([]);
  });

  it("the store→editor sync passes the text it loads", () => {
    const ref = { current: "" };
    expect(syncMarkdownToEditor(editor, "synced 中文", ref, false, "t1")).toBe(true);
    expect(noted).toEqual([{ markdown: "synced 中文", text: "synced 中文" }]);
  });
});
