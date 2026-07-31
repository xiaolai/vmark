/**
 * List Block Bounds Tests
 *
 * Tests for getListBlockBounds() — detecting contiguous list regions
 * in Source mode for smart select-all.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getListBlockBounds } from "../listDetection";

function createView(content: string, cursorPos: number): EditorView {
  const state = EditorState.create({
    doc: content,
    selection: { anchor: cursorPos },
  });
  return new EditorView({
    state,
    parent: document.createElement("div"),
  });
}

describe("getListBlockBounds", () => {
  describe("basic detection", () => {
    it("cursor in bullet list item returns list block bounds", () => {
      const content = "- item one";
      const view = createView(content, 5);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("cursor in ordered list item returns list block bounds", () => {
      const content = "1. first item";
      const view = createView(content, 5);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("cursor in task list item returns list block bounds", () => {
      const content = "- [ ] todo item";
      const view = createView(content, 8);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("cursor in non-list text returns null", () => {
      const content = "Just some text";
      const view = createView(content, 5);
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });

    it("cursor in empty line returns null", () => {
      const content = "- item\n\ntext";
      const view = createView(content, 7); // empty line
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });
  });

  describe("multi-item lists", () => {
    it("3-item bullet list spans all items", () => {
      const content = "- alpha\n- beta\n- gamma";
      const view = createView(content, 3); // in "alpha"
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    // CommonMark: a bullet-char change starts a NEW list, so "- one" /
    // "* two" / "+ three" is three lists and the bounds stop at the change.
    it("mixed markers split into separate lists at each change", () => {
      const content = "- one\n* two\n+ three";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe("- one".length);
      view.destroy();
    });

    it("ordered list spans all items", () => {
      const content = "1. first\n2. second\n3. third";
      const view = createView(content, 5);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });
  });

  describe("nested lists", () => {
    it("indented sub-items included in bounds", () => {
      const content = "- parent\n  - child\n  - child2";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("3-level nesting included", () => {
      const content = "- level 1\n  - level 2\n    - level 3";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });
  });

  describe("blank lines", () => {
    it("blank line between items (loose list) included if next non-blank is list", () => {
      const content = "- item one\n\n- item two";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("blank line before non-list text ends list before blank", () => {
      const content = "- item one\n\nSome paragraph";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe("- item one".length);
      view.destroy();
    });

    it("trailing blank line at end of document excluded", () => {
      const content = "- item\n";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe("- item".length);
      view.destroy();
    });
  });

  describe("boundaries", () => {
    it("list at very start of document", () => {
      const content = "- first\n- second\n\nParagraph";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      view.destroy();
    });

    it("list at very end of document", () => {
      const content = "Paragraph\n\n- first\n- second";
      const view = createView(content, content.length - 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("list surrounded by paragraphs", () => {
      const content = "Para before\n\n- first\n- second\n\nPara after";
      // Cursor in "first"
      const listStart = content.indexOf("- first");
      const view = createView(content, listStart + 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(listStart);
      expect(bounds!.to).toBe(listStart + "- first\n- second".length);
      view.destroy();
    });

    it("two separate lists with paragraph between them", () => {
      const content = "- list A\n\nParagraph\n\n- list B";
      // Cursor in list A
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe("- list A".length);
      view.destroy();
    });
  });

  describe("continuation lines", () => {
    it("a continuation paragraph does not split the list", () => {
      const content = "- item one\n  continuation text\n- item two";
      const view = createView(content, 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("an indented child block after a blank stays in the list", () => {
      const content = "- item one\n\n  child block\n- item two";
      const view = createView(content, content.length - 3);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });
  });

  describe("edge cases", () => {
    it("single-item list returns that one line", () => {
      const content = "- only item";
      const view = createView(content, 5);
      const bounds = getListBlockBounds(view);

      expect(bounds).not.toBeNull();
      expect(bounds!.from).toBe(0);
      expect(bounds!.to).toBe(content.length);
      view.destroy();
    });

    it("horizontal rule (---) is not detected as list", () => {
      const content = "---";
      const view = createView(content, 1);
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });

    it("horizontal rule (***) is not detected as list", () => {
      const content = "***";
      const view = createView(content, 1);
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });

    it("spaced thematic break (- - -) is not detected as list", () => {
      const view = createView("- - -", 1);
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });

    it("spaced thematic break (* * *) is not detected as list", () => {
      const view = createView("* * *", 1);
      expect(getListBlockBounds(view)).toBeNull();
      view.destroy();
    });
  });
});
