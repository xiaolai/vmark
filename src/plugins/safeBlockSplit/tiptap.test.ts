/**
 * Tests for the safe block split extension.
 *
 * Covers: Enter on a selection spanning two blocks splits cleanly (both
 * directions, empty and non-empty blocks), a same-block selection and a
 * collapsed cursor are left to the handlers that own them, and the state of
 * the upstream `splitBlock` defect in the installed `@tiptap/core`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { safeBlockSplitExtension } from "./tiptap";

const editors: Editor[] = [];

function createEditor(content: string, withSafeSplit = true): Editor {
  const editor = new Editor({
    extensions: withSafeSplit ? [StarterKit, safeBlockSplitExtension] : [StarterKit],
    content,
  });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  while (editors.length) editors.pop()?.destroy();
});

/** Press Enter through the DOM keydown path the keymap actually observes. */
function pressEnter(editor: Editor): unknown {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => errors.push(event.error);
  window.addEventListener("error", onError);
  try {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  } catch (error) {
    errors.push(error);
  } finally {
    window.removeEventListener("error", onError);
  }
  return errors[0] ?? null;
}

function paragraphTexts(editor: Editor): string[] {
  const texts: string[] = [];
  editor.state.doc.forEach((node) => texts.push(node.textContent));
  return texts;
}

describe("safeBlockSplitExtension", () => {
  it.each([
    ["forward", 1, 3],
    ["backward", 3, 1],
  ])("splits a %s selection across two empty paragraphs without throwing", (_dir, anchor, head) => {
    const editor = createEditor("<p></p><p></p>");
    editor.commands.setTextSelection({ from: anchor, to: head });

    expect(pressEnter(editor)).toBeNull();
    // The selection is deleted and the remaining block is split: two empty paragraphs.
    expect(paragraphTexts(editor)).toEqual(["", ""]);
  });

  it("deletes a selection spanning two text paragraphs and splits at the join", () => {
    // <p>abc</p><p>def</p>: 1..4 is "abc", 6..9 is "def". Select "bc" + "de".
    const editor = createEditor("<p>abc</p><p>def</p>");
    editor.commands.setTextSelection({ from: 2, to: 8 });

    expect(pressEnter(editor)).toBeNull();
    expect(paragraphTexts(editor)).toEqual(["a", "f"]);
  });

  it("leaves a selection inside one paragraph to the default Enter", () => {
    const editor = createEditor("<p>abcdef</p>");
    editor.commands.setTextSelection({ from: 3, to: 5 });

    expect(pressEnter(editor)).toBeNull();
    expect(paragraphTexts(editor)).toEqual(["ab", "ef"]);
  });

  it("leaves a collapsed cursor to the default Enter", () => {
    const editor = createEditor("<p>abcd</p>");
    editor.commands.setTextSelection(3);

    expect(pressEnter(editor)).toBeNull();
    expect(paragraphTexts(editor)).toEqual(["ab", "cd"]);
  });
});

describe("upstream splitBlock on a cross-block selection (vanilla StarterKit)", () => {
  // The header records that the installed @tiptap/core (3.31.4) no longer
  // throws here. If this starts failing, upstream regressed and the extension
  // is load-bearing again; update the header's version note.
  it("does not throw in the installed @tiptap/core", () => {
    const editor = createEditor("<p>abc</p><p>def</p>", false);
    editor.commands.setTextSelection({ from: 2, to: 8 });

    expect(pressEnter(editor)).toBeNull();
    expect(paragraphTexts(editor)).toEqual(["a", "f"]);
  });
});
