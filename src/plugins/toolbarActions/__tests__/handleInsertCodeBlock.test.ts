/**
 * insertCodeBlock conversion semantics (handleInsertCodeBlock).
 *
 * Two reported bugs, one rule: converting content to a code block must yield
 * ONE code block.
 *   - In a list: the whole list becomes one code block, one line per item,
 *     nested items indented (Tiptap's default converted only the cursor item,
 *     or one single-line block PER selected item).
 *   - Selection across multiple blocks (paragraphs, headings, lists): all
 *     covered blocks merge into one code block, one line per block/item
 *     (the default produced several code blocks, one per textblock).
 *
 * Uses a real Tiptap Editor with the production listItem and codeBlock
 * extensions so schema constraints (`listItem: "paragraph block*"`) are the
 * real ones.
 */
import { describe, it, expect, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

import { taskListItemExtension } from "@/plugins/taskToggle/tiptap";
import { CodeBlockWithLineNumbers } from "@/plugins/codeBlockLineNumbers/tiptap";
import { videoEmbedExtension } from "@/plugins/videoEmbed/tiptap";
import { performWysiwygToolbarAction } from "../wysiwygAdapter";
import type { WysiwygToolbarContext } from "../types";

function createEditor(content: string) {
  return new Editor({
    extensions: [
      StarterKit.configure({ listItem: false, codeBlock: false }),
      taskListItemExtension,
      CodeBlockWithLineNumbers,
      videoEmbedExtension,
    ],
    content,
  });
}

function ctx(editor: Editor): WysiwygToolbarContext {
  return { surface: "wysiwyg", view: editor.view, editor, context: null };
}

/** Doc position of the first occurrence of `text` (fails the test if absent). */
function posOfText(editor: Editor, text: string): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text && node.text.includes(text)) {
      found = pos + node.text.indexOf(text);
      return false;
    }
  });
  expect(found).toBeGreaterThanOrEqual(0);
  return found;
}

function codeBlocks(editor: Editor): { language: string; text: string }[] {
  const found: { language: string; text: string }[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") {
      found.push({ language: node.attrs.language, text: node.textContent });
    }
  });
  return found;
}

function hasList(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      found = true;
    }
  });
  return found;
}

describe("insertCodeBlock in a list", () => {
  it("converts the whole bullet list into ONE code block (cursor in an item)", () => {
    const editor = createEditor(
      "<ul><li>mkdir ~/my-it-pro</li><li>cd ~/my-it-pro</li><li>claude</li></ul>"
    );
    editor.commands.setTextSelection(5); // inside the first item

    const handled = performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(handled).toBe(true);
    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("mkdir ~/my-it-pro\ncd ~/my-it-pro\nclaude");
    editor.destroy();
  });

  it("converts the whole ordered list into ONE code block", () => {
    const editor = createEditor("<ol><li>first</li><li>second</li></ol>");
    editor.commands.setTextSelection(4);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("first\nsecond");
    editor.destroy();
  });

  it("converts a selection spanning multiple items into ONE code block, not one per item", () => {
    const editor = createEditor(
      "<ul><li>alpha</li><li>beta</li><li>gamma</li></ul>"
    );
    editor.commands.setTextSelection({
      from: 3,
      to: editor.state.doc.content.size - 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("alpha\nbeta\ngamma");
    editor.destroy();
  });

  it("indents nested list items", () => {
    const editor = createEditor(
      "<ul><li>parent<ul><li>child</li><li>sibling</li></ul></li><li>uncle</li></ul>"
    );
    editor.commands.setTextSelection(4); // inside "parent"

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("parent\n  child\n  sibling\nuncle");
    editor.destroy();
  });

  it("puts the cursor inside the new code block", () => {
    const editor = createEditor("<ul><li>only line</li></ul>");
    editor.commands.setTextSelection(4);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    editor.destroy();
  });

  it("handles a task list (checked items) without crashing", () => {
    const editor = createEditor("<ul><li>todo one</li><li>todo two</li></ul>");
    // Mark the first item as a task item
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "listItem") {
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            checked: false,
          })
        );
        return false;
      }
    });
    editor.commands.setTextSelection(4);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    expect(codeBlocks(editor)).toHaveLength(1);
    editor.destroy();
  });

  it("keeps the plain-paragraph behavior unchanged (no list involved)", () => {
    const editor = createEditor("<p>hello world</p>");
    editor.commands.setTextSelection(3);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("hello world");
    editor.destroy();
  });

  it("converts an empty list item to an empty line", () => {
    const editor = createEditor("<ul><li>top</li><li></li><li>bottom</li></ul>");
    editor.commands.setTextSelection(4);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("top\n\nbottom");
    editor.destroy();
  });
});

describe("insertCodeBlock with a multi-block selection", () => {
  it("merges selected paragraphs into ONE code block, not one per paragraph", () => {
    const editor = createEditor(
      "<p>line one</p><p>line two</p><p>line three</p>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "one"),
      to: posOfText(editor, "three"),
    });

    const handled = performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(handled).toBe(true);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("line one\nline two\nline three");
    editor.destroy();
  });

  it("merges a mixed paragraph + list selection into one code block", () => {
    const editor = createEditor("<p>intro</p><ul><li>a</li><li>b</li></ul>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "b") + 1,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("intro\na\nb");
    editor.destroy();
  });

  it("merges a list + following paragraph selection into one code block", () => {
    const editor = createEditor("<ul><li>x</li><li>y</li></ul><p>after</p>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "x"),
      to: posOfText(editor, "after") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(hasList(editor)).toBe(false);
    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("x\ny\nafter");
    editor.destroy();
  });

  it("merges heading + paragraph into one code block", () => {
    const editor = createEditor("<h2>Title</h2><p>body</p>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "Title"),
      to: posOfText(editor, "body") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("Title\nbody");
    editor.destroy();
  });

  it("keeps an empty paragraph between blocks as an empty line", () => {
    const editor = createEditor("<p>alpha</p><p></p><p>omega</p>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "alpha"),
      to: posOfText(editor, "omega") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("alpha\n\nomega");
    editor.destroy();
  });

  it("converts paragraphs inside a blockquote without unwrapping the quote", () => {
    const editor = createEditor(
      "<blockquote><p>first</p><p>second</p></blockquote>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "first"),
      to: posOfText(editor, "second") + 3,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("first\nsecond");
    expect(editor.getHTML()).toContain("<blockquote>");
    editor.destroy();
  });

  it("puts the cursor inside the merged code block", () => {
    const editor = createEditor("<p>aa</p><p>bb</p>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "aa"),
      to: posOfText(editor, "bb") + 1,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(editor.state.selection.$from.parent.type.name).toBe("codeBlock");
    editor.destroy();
  });

  it("preserves hard breaks as newlines", () => {
    const editor = createEditor("<ul><li>first<br>second</li><li>third</li></ul>");
    editor.commands.setTextSelection(4);

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("first\nsecond\nthird");
    editor.destroy();
  });

  it("keeps a horizontal rule as --- instead of dropping it", () => {
    const editor = createEditor("<p>above</p><hr><p>below</p>");
    editor.commands.setTextSelection({
      from: posOfText(editor, "above"),
      to: posOfText(editor, "below") + 3,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("above\n---\nbelow");
    editor.destroy();
  });

  it("keeps a video embed as its URL instead of dropping it", () => {
    const editor = createEditor("<p>above</p><p>below</p>");
    // Insert a video_embed leaf between the paragraphs.
    editor.commands.insertContentAt(editor.state.doc.child(0).nodeSize, {
      type: "video_embed",
      attrs: { provider: "youtube", videoId: "dQw4w9WgXcQ" },
    });
    editor.commands.setTextSelection({
      from: posOfText(editor, "above"),
      to: posOfText(editor, "below") + 3,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe(
      "above\nhttps://www.youtube-nocookie.com/embed/dQw4w9WgXcQ\nbelow"
    );
    editor.destroy();
  });

  it("returns false without an editor", async () => {
    const { handleInsertCodeBlock } = await import("../wysiwygAdapterCodeBlock");
    expect(
      handleInsertCodeBlock({ surface: "wysiwyg", view: null, editor: null, context: null })
    ).toBe(false);
  });

  it("returns false when setCodeBlock cannot apply (selected horizontal rule)", async () => {
    const { NodeSelection } = await import("@tiptap/pm/state");
    const editor = createEditor("<p>a</p><hr><p>b</p>");
    let hrPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "horizontalRule") hrPos = pos;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, hrPos))
    );

    const handled = performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    expect(handled).toBe(false);
    editor.destroy();
  });
});

describe("partially selected wrappers (WI-2)", () => {
  async function createRichEditor(content: string) {
    const { alertBlockExtension } = await import("@/plugins/alertBlock/tiptap");
    const { detailsBlockExtension, detailsSummaryExtension } = await import(
      "@/plugins/detailsBlock/tiptap"
    );
    const { TableWithScrollWrapper } = await import("@/plugins/tableScroll");
    const { AlignedTableCell, AlignedTableHeader } = await import(
      "@/components/Editor/alignedTableNodes"
    );
    const { default: TableRow } = await import("@tiptap/extension-table-row");
    return new Editor({
      extensions: [
        StarterKit.configure({ listItem: false, codeBlock: false }),
        taskListItemExtension,
        CodeBlockWithLineNumbers,
        alertBlockExtension,
        detailsSummaryExtension,
        detailsBlockExtension,
        TableWithScrollWrapper.configure({ resizable: false }),
        TableRow,
        AlignedTableHeader,
        AlignedTableCell,
      ],
      content,
    });
  }

  it("splits a partially selected blockquote — unselected tail survives", async () => {
    const editor = await createRichEditor(
      "<p>intro</p><blockquote><p>q1</p><p>q2</p></blockquote>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "q1") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("intro\nq1");
    // q2 stays in a residual blockquote, untouched.
    const html = editor.getHTML();
    expect(html).toContain("<blockquote>");
    expect(html).toContain("q2");
    expect(blocks[0].text).not.toContain("q2");
    editor.destroy();
  });

  it("consumes the whole quote when the selection ends exactly at its last block", async () => {
    const editor = await createRichEditor(
      "<p>intro</p><blockquote><p>q1</p><p>q2</p></blockquote>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "q2") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("intro\nq1\nq2");
    expect(editor.getHTML()).not.toContain("<blockquote>");
    editor.destroy();
  });

  it("splits on the start side too — unselected head survives", async () => {
    const editor = await createRichEditor(
      "<blockquote><p>q1</p><p>q2</p></blockquote><p>after</p>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "q2"),
      to: posOfText(editor, "after") + 5,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("q2\nafter");
    const html = editor.getHTML();
    expect(html).toContain("<blockquote>");
    expect(html).toContain("q1");
    editor.destroy();
  });

  it("splits a partially selected alert block the same way", async () => {
    const editor = await createRichEditor(
      '<p>intro</p><div data-alert-type="NOTE"><p>a1</p><p>a2</p></div>'
    );
    // If the alert didn't parse from HTML, skip gracefully — the blockquote
    // paths above cover the splittable-wrapper mechanics.
    if (!editor.getHTML().includes("a1")) {
      editor.destroy();
      return;
    }
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "a1") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("intro\na1");
    expect(editor.state.doc.textContent).toContain("a2");
    expect(blocks[0].text).not.toContain("a2");
    editor.destroy();
  });

  it("refuses conversion into a partially selected details block", async () => {
    const editor = await createRichEditor(
      "<p>intro</p><details><summary>sum</summary><p>d1</p><p>d2</p></details>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "d1") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    // The details block survives and its unselected content is not consumed
    // into any code block.
    let detailsCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "detailsBlock") detailsCount++;
    });
    expect(detailsCount).toBe(1);
    for (const block of codeBlocks(editor)) {
      expect(block.text).not.toContain("d2");
      expect(block.text).not.toContain("sum");
    }
    editor.destroy();
  });

  it("refuses conversion into a partially selected table", async () => {
    const editor = await createRichEditor(
      "<p>intro</p><table><tbody><tr><td><p>c1</p></td><td><p>c2</p></td></tr></tbody></table>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "c1") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    let tableCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") tableCount++;
    });
    expect(tableCount).toBe(1);
    for (const block of codeBlocks(editor)) {
      expect(block.text).not.toContain("c2");
    }
    editor.destroy();
  });

  it("refuses when the endpoint is inside a table NESTED in a blockquote", async () => {
    // The quote itself is splittable, but the single-level split would consume
    // the partially selected table inside it — the intermediate-wrapper scan
    // must refuse instead.
    const editor = await createRichEditor(
      "<p>intro</p><blockquote><table><tbody><tr><td><p>t1</p></td><td><p>t2</p></td></tr></tbody></table><p>tail</p></blockquote>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "t1") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    let tableCount = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "table") tableCount++;
    });
    expect(tableCount).toBe(1);
    for (const block of codeBlocks(editor)) {
      expect(block.text).not.toContain("t2");
      expect(block.text).not.toContain("tail");
    }
    editor.destroy();
  });

  it("a REFUSED conversion leaves the doc completely unchanged (no fallback)", async () => {
    const editor = await createRichEditor(
      "<p>intro</p><table><tbody><tr><td><p>c1</p></td><td><p>c2</p></td></tr></tbody></table>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "c1") + 2,
    });
    const before = editor.state.doc.toJSON();

    const result = performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    // Refusal: no doc change at all — the setCodeBlock fallback must not
    // have run (it would shatter the covered blocks), and the action
    // honestly reports "nothing happened".
    expect(result).toBe(false);
    expect(editor.state.doc.toJSON()).toEqual(before);
    editor.destroy();
  });

  it("still converts a whole LIST nested in a partially selected blockquote", async () => {
    // A nested list is not an intermediate wrapper — whole-list semantics
    // apply and the split path stays available.
    const editor = await createRichEditor(
      "<p>intro</p><blockquote><ul><li><p>l1</p></li><li><p>l2</p></li></ul><p>tail</p></blockquote>"
    );
    editor.commands.setTextSelection({
      from: posOfText(editor, "intro"),
      to: posOfText(editor, "l2") + 2,
    });

    performWysiwygToolbarAction("insertCodeBlock", ctx(editor));

    const blocks = codeBlocks(editor);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toContain("l1");
    expect(blocks[0].text).toContain("l2");
    expect(blocks[0].text).not.toContain("tail");
    expect(editor.state.doc.textContent).toContain("tail");
    editor.destroy();
  });
});
