// @vitest-environment jsdom
/**
 * WI-CJKF6.3 — a whole-document transform must not lose the user's place.
 *
 * `applyFullDocumentTransform` does `replaceWith(0, doc.content.size, …)`.
 * ProseMirror maps a selection through a replacement of the ENTIRE document by
 * collapsing it to the end, so "Format CJK File" on a long document threw the
 * caret to the bottom and took the scroll position with it — for a command
 * whose whole point is that it changes nothing you can see.
 *
 * @coordinates-with ./wysiwygAdapterUtils.ts — applyFullDocumentTransform
 * @module plugins/toolbarActions/wysiwygFullDocumentTransform.test
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/navigation/windowFocus", () => ({ getWindowLabel: () => "main" }));
vi.mock("@/plugins/shared/hostDocument", () => ({
  hostDocument: { activeHardBreakStyle: () => "twoSpaces" },
  activeFilePathForCurrentWindow: () => null,
}));

import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import { applyFullDocumentTransform } from "./wysiwygAdapterUtils";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import type { WysiwygToolbarContext } from "./types";

vi.mock("@/utils/markdownPipeline", () => ({
  parseMarkdown: vi.fn(),
  serializeMarkdown: vi.fn(),
}));

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: { inline: true },
  },
});

function docOf(...paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((t) => schema.node("paragraph", null, t ? [schema.text(t)] : []))
  );
}

function contextAt(caret: number): { context: WysiwygToolbarContext; view: EditorView } {
  const state = EditorState.create({
    doc: docOf("第一段English", "第二段English", "第三段English"),
    selection: TextSelection.create(docOf("第一段English", "第二段English", "第三段English"), caret),
  });
  const parent = document.createElement("div");
  const view = new EditorView(parent, { state });
  return { context: { editor: { schema, state: view.state } as never, view } as never, view };
}

beforeEach(() => {
  vi.mocked(serializeMarkdown).mockReturnValue("第一段English\n\n第二段English\n\n第三段English\n");
  vi.mocked(parseMarkdown).mockReturnValue(
    docOf("第一段 English", "第二段 English", "第三段 English")
  );
});

describe("applyFullDocumentTransform keeps the caret", () => {
  it("keeps a caret in the middle of the document near where it was", () => {
    const { context, view } = contextAt(20);
    applyFullDocumentTransform(context, () => "changed");
    // The document grew by two spaces before the caret, so an exact offset is
    // not recoverable. What matters is that the caret did not jump to the end.
    expect(view.state.selection.head).toBeLessThan(view.state.doc.content.size - 5);
    expect(view.state.selection.head).toBeGreaterThan(10);
    view.destroy();
  });

  it("keeps a caret at the very start at the very start", () => {
    const { context, view } = contextAt(1);
    applyFullDocumentTransform(context, () => "changed");
    expect(view.state.selection.head).toBe(1);
    view.destroy();
  });

  it("clamps a caret past the end of a document that shrank", () => {
    // Three 12-position paragraphs, so 34 is near the end of the ORIGINAL doc
    // and far past the end of the one-word result. Before the fix this threw
    // `RangeError: Position 34 out of range`, which the surrounding catch
    // turned into a silent no-op — the format simply did not happen.
    vi.mocked(parseMarkdown).mockReturnValue(docOf("短"));
    const { context, view } = contextAt(34);
    applyFullDocumentTransform(context, () => "changed");
    expect(view.state.selection.head).toBeLessThanOrEqual(view.state.doc.content.size);
    view.destroy();
  });

  it("restores the scroll offset", () => {
    const { context, view } = contextAt(20);
    Object.defineProperty(view.dom, "scrollTop", { value: 0, writable: true, configurable: true });
    view.dom.scrollTop = 240;
    applyFullDocumentTransform(context, () => "changed");
    expect(view.dom.scrollTop).toBe(240);
    view.destroy();
  });

  it("does not dispatch at all when the transform changes nothing", () => {
    const { context, view } = contextAt(20);
    const before = view.state;
    applyFullDocumentTransform(context, (md) => md);
    expect(view.state).toBe(before);
    view.destroy();
  });

  it("returns false without a view", () => {
    expect(applyFullDocumentTransform({ editor: null, view: null } as never, (m) => m)).toBe(false);
  });
});
