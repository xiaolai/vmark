// Tests for the spellcheck-threshold helpers: the mount-time attribute must
// flip when a document crosses SPELLCHECK_DISABLE_CHAR_THRESHOLD mid-session
// (the original editorProps value is computed once and never re-evaluated).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  applySpellcheckForDocSize,
  buildTiptapEditorProps,
  SPELLCHECK_DISABLE_CHAR_THRESHOLD,
  spellcheckAttrForDocSize,
} from "./tiptapEditorHelpers";

describe("buildTiptapEditorProps", () => {
  it("snapshots the spellcheck attribute from the doc size", () => {
    const small = buildTiptapEditorProps(10).attributes as Record<string, string>;
    const large = buildTiptapEditorProps(
      SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1,
    ).attributes as Record<string, string>;
    expect(small.spellcheck).toBe("true");
    expect(large.spellcheck).toBe("false");
    expect(small.class).toBe("ProseMirror");
  });

  it("wires the table-aware scroll handler", () => {
    expect(typeof buildTiptapEditorProps(0).handleScrollToSelection).toBe("function");
  });
});

describe("spellcheckAttrForDocSize", () => {
  it.each([
    { docSize: 0, expected: "true" },
    { docSize: SPELLCHECK_DISABLE_CHAR_THRESHOLD, expected: "true" },
    { docSize: SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1, expected: "false" },
    { docSize: 1_000_000, expected: "false" },
  ])("docSize=$docSize → $expected", ({ docSize, expected }) => {
    expect(spellcheckAttrForDocSize(docSize)).toBe(expected);
  });
});

describe("applySpellcheckForDocSize", () => {
  let editor: Editor;

  beforeEach(() => {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [StarterKit],
      editorProps: {
        attributes: { class: "ProseMirror", spellcheck: "true" },
      },
    });
  });

  afterEach(() => {
    editor.destroy();
  });

  it("disables spellcheck when the doc grows past the threshold", () => {
    const changed = applySpellcheckForDocSize(
      editor,
      SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1,
    );
    expect(changed).toBe(true);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("false");
  });

  it("re-enables spellcheck when the doc shrinks below the threshold", () => {
    applySpellcheckForDocSize(editor, SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1);
    const changed = applySpellcheckForDocSize(editor, 10);
    expect(changed).toBe(true);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("true");
  });

  it("is a no-op when the attribute already matches", () => {
    expect(applySpellcheckForDocSize(editor, 10)).toBe(false);
    expect(editor.view.dom.getAttribute("spellcheck")).toBe("true");
  });

  it("preserves the other editorProps attributes when flipping", () => {
    applySpellcheckForDocSize(editor, SPELLCHECK_DISABLE_CHAR_THRESHOLD + 1);
    expect(editor.view.dom.getAttribute("class")).toContain("ProseMirror");
  });

  it("survives an editor without a mounted view", () => {
    editor.destroy();
    expect(applySpellcheckForDocSize(editor, 10)).toBe(false);
  });
});
