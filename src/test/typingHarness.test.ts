/**
 * WI-1.2 — the typing harness's own plumbing proofs.
 *
 * These are NOT the editing matrix (that is WI-1.3's data-driven file); they
 * prove each harness channel reaches the production stack: text input rules,
 * keymap keys, handleDOMEvents keys, history, serializer, and the module-state
 * reset. If one of these fails, every matrix result is meaningless — so the
 * matrix depends on this file staying green.
 *
 * @coordinates-with typingHarness.ts — the module under test
 * @module test/typingHarness.test
 */
import { describe, it, expect } from "vitest";
import { createTypingSession, withTypingSession } from "./typingHarness";

describe("typing harness plumbing (production stack in jsdom)", () => {
  it("routes text through production input rules — '# ' becomes a heading", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("# ");
      expect(s.editor.state.doc.firstChild!.type.name).toBe("heading");
    });
  });

  it("falls back to plain insertion for unclaimed characters", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("plain");
      expect(s.editor.state.doc.textContent).toBe("plain");
    });
  });

  it("Enter reaches the keymap — a paragraph splits", () => {
    withTypingSession({ markdown: "ab" }, (s) => {
      s.setCursor(2); // between a and b
      const handled = s.press("Enter");
      expect(handled).toBe(true);
      expect(s.editor.state.doc.childCount).toBe(2);
    });
  });

  it("Backspace deletes a character via the browser-default path", () => {
    withTypingSession({ markdown: "ab" }, (s) => {
      s.setCursor(3); // after b
      const handled = s.press("Backspace");
      // Faithful semantics: ProseMirror's keymap does NOT claim plain
      // character deletion (the browser does it) — so handled is false and
      // the harness's browser-default applies the edit.
      expect(handled).toBe(false);
      expect(s.editor.state.doc.textContent).toBe("a");
    });
  });

  it("forward Delete removes the character after the caret", () => {
    withTypingSession({ markdown: "ab" }, (s) => {
      s.setCursor(1); // before a
      s.press("Delete");
      expect(s.editor.state.doc.textContent).toBe("b");
    });
  });

  it("Backspace with a non-empty selection deletes the whole range", () => {
    withTypingSession({ markdown: "abcdef" }, (s) => {
      s.select(2, 5); // "bcd"
      s.press("Backspace");
      expect(s.editor.state.doc.textContent).toBe("aef");
    });
  });

  it("Backspace never splits a surrogate pair", () => {
    withTypingSession({ markdown: "a😀" }, (s) => {
      s.setCursor(4); // after the astral emoji (2 code units)
      s.press("Backspace");
      expect(s.editor.state.doc.textContent).toBe("a");
    });
  });

  it("keydown reaches handleDOMEvents plugins, not only keymaps", () => {
    // listBackspace registers via handleDOMEvents.keydown (its tiptap.ts
    // documents that keyboardShortcut() bypasses it). An empty top-level list
    // item at doc start: Backspace lifts it back to a paragraph.
    withTypingSession({ markdown: "- \n" }, (s) => {
      const listItemPos = 3;
      s.setCursor(listItemPos);
      s.press("Backspace");
      const names: string[] = [];
      s.editor.state.doc.descendants((n) => {
        names.push(n.type.name);
      });
      expect(names).not.toContain("listItem");
    });
  });

  it("serializes through the production serializer", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("# ");
      s.type("Title");
      // Pinned production reality: the heading input rule leaves an empty
      // paragraph after the new heading (caret stays in the heading), which
      // serializes as a trailing blank line. Harmless — a reparse collapses
      // it — but the harness reports what the stack DOES, not what a mock
      // would.
      expect(s.markdown()).toBe("# Title\n\n");
    });
  });

  it("undo/redo run through the live history extension", () => {
    withTypingSession({ markdown: "" }, (s) => {
      s.type("abc");
      expect(s.editor.state.doc.textContent).toBe("abc");
      expect(s.undo()).toBe(true);
      expect(s.editor.state.doc.textContent).toBe("");
      expect(s.redo()).toBe(true);
      expect(s.editor.state.doc.textContent).toBe("abc");
    });
  });

  it("resets autoPair's module-global backtick state between sessions", () => {
    // Session A leaves the consecutive-backtick machine at 2. Without the
    // reset, session B's FIRST backtick would count as the third and create a
    // code block.
    const a = createTypingSession({ markdown: "" });
    a.type("``");
    a.destroy();

    withTypingSession({ markdown: "" }, (b) => {
      b.type("`");
      const names: string[] = [];
      b.editor.state.doc.descendants((n) => {
        names.push(n.type.name);
      });
      expect(names).not.toContain("codeBlock");
    });
  });

  it("loads initial markdown through the production parser", () => {
    withTypingSession({ markdown: "> quoted\n" }, (s) => {
      expect(s.editor.state.doc.firstChild!.type.name).toBe("blockquote");
    });
  });
});
