/**
 * Tests for list backspace extension.
 *
 * Tests two-step Backspace behavior in lists:
 * 1. First Backspace at content start: lift item out of list (become paragraph)
 * 2. Second Backspace: standard paragraph joining
 *
 * This ensures Backspace never directly merges content into the previous
 * list item (skipping the "become a paragraph" step).
 */

import { describe, it, expect } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { listBackspaceExtension } from "./tiptap";

function createEditor(content: string) {
  return new Editor({
    extensions: [StarterKit, listBackspaceExtension],
    content,
  });
}

/**
 * Simulate a real Backspace keypress via DOM keydown dispatch — the path
 * the handler actually observes in production. `editor.commands.keyboardShortcut`
 * bypasses DOM events and therefore bypasses handleDOMEvents.keydown.
 */
function pressBackspace(editor: Editor): void {
  const event = new KeyboardEvent("keydown", {
    key: "Backspace",
    bubbles: true,
    cancelable: true,
  });
  editor.view.dom.dispatchEvent(event);
}

describe("listBackspaceExtension", () => {
  describe("second item becomes paragraph (not merged into first)", () => {
    it("lifts second list item to paragraph on Backspace at content start", () => {
      const editor = createEditor(
        "<ul><li>First</li><li>Second</li></ul>"
      );

      // Position cursor at start of "Second" (inside second list item)
      // Doc: <doc><bulletList><listItem><p>First</p></listItem><listItem><p>Second</p></listItem></bulletList></doc>
      // We need to place cursor at start of "Second" text node
      const doc = editor.state.doc;
      let secondItemStart = 0;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === "Second") {
          secondItemStart = pos;
          return false;
        }
      });
      editor.commands.setTextSelection(secondItemStart);

      pressBackspace(editor);

      const html = editor.getHTML();
      // Second item should become a paragraph, NOT merged into first item
      // Expected: list with "First" + paragraph with "Second"
      expect(html).toContain("First");
      expect(html).toContain("Second");
      // "Second" should NOT be inside the list anymore
      // It should be a separate paragraph after the list
      expect(html).toMatch(/<p>Second<\/p>/);

      editor.destroy();
    });
  });

  describe("first item becomes paragraph before list", () => {
    it("lifts first list item out of list on Backspace at content start", () => {
      const editor = createEditor(
        "<ul><li>First</li><li>Second</li></ul>"
      );

      // Position cursor at start of "First"
      const doc = editor.state.doc;
      let firstItemStart = 0;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === "First") {
          firstItemStart = pos;
          return false;
        }
      });
      editor.commands.setTextSelection(firstItemStart);

      pressBackspace(editor);

      const html = editor.getHTML();
      // First item should become a paragraph before the remaining list
      expect(html).toContain("First");
      expect(html).toContain("Second");
      // "First" should be a paragraph, "Second" should remain in list
      expect(html).toMatch(/<p>First<\/p>/);

      editor.destroy();
    });
  });

  describe("nested item lifts to parent level", () => {
    it("lifts nested list item to parent level on Backspace", () => {
      const editor = createEditor(
        "<ul><li>Parent<ul><li>Nested</li></ul></li></ul>"
      );

      // Position cursor at start of "Nested"
      const doc = editor.state.doc;
      let nestedStart = 0;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === "Nested") {
          nestedStart = pos;
          return false;
        }
      });
      editor.commands.setTextSelection(nestedStart);

      pressBackspace(editor);

      const html = editor.getHTML();
      // Nested item should lift to parent level (standard liftListItem behavior)
      expect(html).toContain("Parent");
      expect(html).toContain("Nested");

      editor.destroy();
    });
  });

  describe("does not interfere with normal editing", () => {
    it("returns false when cursor is in middle of text", () => {
      const editor = createEditor("<ul><li>Hello World</li></ul>");

      // Position cursor in the middle of "Hello World"
      editor.commands.setTextSelection(8); // middle of text

      // Should let normal backspace handle it (delete a char)
      pressBackspace(editor);

      const html = editor.getHTML();
      // A character should have been deleted, not the whole marker removed
      expect(html).toContain("<li>");

      editor.destroy();
    });

    it("returns false when selection is not empty", () => {
      const editor = createEditor("<ul><li>Hello World</li></ul>");

      // Select some text
      editor.commands.setTextSelection({ from: 3, to: 6 });

      // Should let normal behavior handle the selection delete
      pressBackspace(editor);

      const html = editor.getHTML();
      expect(html).toContain("<li>");

      editor.destroy();
    });

    it("returns false when cursor is not in a list", () => {
      const editor = createEditor("<p>Normal paragraph</p>");

      // Position at start
      editor.commands.setTextSelection(1);

      // Should not interfere
      pressBackspace(editor);

      // Paragraph should still exist
      const html = editor.getHTML();
      expect(html).toContain("Normal paragraph");

      editor.destroy();
    });
  });

  describe("empty list item at content start", () => {
    it("deletes empty last list item without splitting the list (#790)", () => {
      const editor = createEditor(
        "<ul><li>First</li><li>Second</li><li></li></ul>"
      );

      editor.commands.focus("end");
      pressBackspace(editor);

      const html = editor.getHTML();
      expect(html).toContain("First");
      expect(html).toContain("Second");
      // Bug fingerprint: list split into `</ul><p></p><ul>`. Must not occur.
      expect(html).not.toMatch(/<\/ul>\s*<p><\/p>\s*<ul>/);
      // Single <ul> — list stays contiguous.
      expect((html.match(/<ul>/g) ?? []).length).toBe(1);

      editor.destroy();
    });

    it("deletes empty middle list item without splitting the list (#790)", () => {
      const editor = createEditor(
        "<ul><li>First</li><li>Second</li><li></li><li>Fourth</li></ul>"
      );

      const doc = editor.state.doc;
      let emptyItemPos = 0;
      doc.descendants((node, pos) => {
        if (node.type.name === "listItem" && node.textContent === "") {
          emptyItemPos = pos + 2; // inside the empty paragraph
          return false;
        }
      });
      editor.commands.setTextSelection(emptyItemPos);

      pressBackspace(editor);

      const html = editor.getHTML();
      expect(html).toContain("First");
      expect(html).toContain("Second");
      expect(html).toContain("Fourth");
      // Core of #790: no split with a blank paragraph between list halves.
      expect(html).not.toMatch(/<\/ul>\s*<p><\/p>\s*<ul>/);
      expect((html.match(/<ul>/g) ?? []).length).toBe(1);

      editor.destroy();
    });
  });

  describe("ordered list backspace", () => {
    it("lifts ordered list item to paragraph on Backspace", () => {
      const editor = createEditor(
        "<ol><li>First</li><li>Second</li></ol>"
      );

      const doc = editor.state.doc;
      let secondItemStart = 0;
      doc.descendants((node, pos) => {
        if (node.isText && node.text === "Second") {
          secondItemStart = pos;
          return false;
        }
      });
      editor.commands.setTextSelection(secondItemStart);

      pressBackspace(editor);

      const html = editor.getHTML();
      expect(html).toContain("First");
      expect(html).toContain("Second");
      expect(html).toMatch(/<p>Second<\/p>/);

      editor.destroy();
    });
  });
});
