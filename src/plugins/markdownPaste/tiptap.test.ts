import { describe, it, expect, vi } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { getSchema } from "@tiptap/core";
import { EditorState, TextSelection, SelectionRange, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { Node as PMNode } from "@tiptap/pm/model";
import { MultiSelection } from "@/plugins/multiCursor/MultiSelection";
import type { MarkdownPasteMode } from "@/stores/settingsStore";
import {
  createMarkdownPasteTransaction,
  shouldHandleMarkdownPaste,
  triggerPastePlainText,
} from "./tiptap";

const schema = getSchema([StarterKit]);

function createParagraphDoc(text: string) {
  const paragraph = schema.nodes.paragraph.create(
    null,
    text ? schema.text(text) : undefined
  );
  return schema.nodes.doc.create(null, [paragraph]);
}

function containsNode(doc: PMNode, typeName: string): boolean {
  let found = false;
  doc.descendants((node) => {
    if (node.type.name === typeName) {
      found = true;
      return false;
    }
    return true;
  });
  return found;
}

function createState(doc: PMNode, selectionPos = 1) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, selectionPos),
  });
}

function createMultiSelectionState(doc: PMNode, ranges: Array<{ from: number; to: number }>) {
  const base = EditorState.create({ doc });
  const selectionRanges = ranges.map((range) => {
    return new SelectionRange(doc.resolve(range.from), doc.resolve(range.to));
  });
  const multiSel = new MultiSelection(selectionRanges, 0);
  return base.apply(base.tr.setSelection(multiSel));
}

describe("markdownPasteExtension", () => {
  it("creates code blocks from fenced markdown", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "```js\nconst a = 1;\n```");
    expect(tr).not.toBeNull();

    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "codeBlock")).toBe(true);
    }
  });

  it("creates lists from markdown list text", () => {
    const state = createState(createParagraphDoc(""));
    const tr = createMarkdownPasteTransaction(state, "- first\n- second");
    expect(tr).not.toBeNull();

    if (tr) {
      const next = state.apply(tr);
      expect(containsNode(next.doc, "bulletList")).toBe(true);
    }
  });

  it("skips markdown parsing inside code blocks", () => {
    const codeBlock = schema.nodes.codeBlock.create(null, schema.text("code"));
    const doc = schema.nodes.doc.create(null, [codeBlock]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });

    const result = shouldHandleMarkdownPaste(state, "- item", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("skips markdown parsing inside inline code marks", () => {
    const codeMark = schema.marks.code;
    const paragraph = schema.nodes.paragraph.create(
      null,
      schema.text("code", codeMark ? [codeMark.create()] : undefined)
    );
    const doc = schema.nodes.doc.create(null, [paragraph]);
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 2),
    });

    const result = shouldHandleMarkdownPaste(state, "- item", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("skips markdown parsing for multi-selection", () => {
    const doc = createParagraphDoc("hello world");
    const state = createMultiSelectionState(doc, [
      { from: 1, to: 6 },
      { from: 7, to: 12 },
    ]);

    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("does not treat plain text as markdown", () => {
    const state = createState(createParagraphDoc(""));
    const result = shouldHandleMarkdownPaste(state, "Just a sentence.", {
      pasteMode: "auto",
      html: "",
    });
    expect(result).toBe(false);
  });

  it("respects paste mode off", () => {
    const state = createState(createParagraphDoc(""));
    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "off" as MarkdownPasteMode,
      html: "",
    });
    expect(result).toBe(false);
  });

  it("handles markdown with non-substantial HTML wrapper", () => {
    const state = createState(createParagraphDoc(""));
    // Two divs (not substantial - needs > 2 to be substantial)
    const result = shouldHandleMarkdownPaste(state, "# Title\nText", {
      pasteMode: "auto",
      html: "<div># Title</div><div>Text</div>",
    });
    expect(result).toBe(true);
  });

  it("skips markdown parsing when HTML is substantial", () => {
    const state = createState(createParagraphDoc(""));
    // Substantial HTML (with formatting tags) should be handled by htmlPaste
    const result = shouldHandleMarkdownPaste(state, "Bold text", {
      pasteMode: "auto",
      html: "<p><strong>Bold text</strong></p>",
    });
    expect(result).toBe(false);
  });

  it("pastes plain text from clipboard", async () => {
    vi.mocked(readText).mockResolvedValue("Plain");
    let state = createState(createParagraphDoc(""));
    const view = {
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        state = state.apply(tr);
      },
    } as unknown as EditorView;

    await triggerPastePlainText(view);
    expect(state.doc.textContent).toBe("Plain");
  });
});
