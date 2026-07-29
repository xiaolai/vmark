/**
 * Language picking on the REAL CodeBlockNodeView, driven through a real
 * Tiptap Editor.
 *
 * The reported bug: choosing a language from a code block's dropdown did not
 * change that block's language tag. Root cause: applyLanguage used
 * `updateAttributes("codeBlock", …)`, which targets the code block at the
 * CURRENT SELECTION — clicking the chip does not move the selection (its
 * mousedown is prevented), so with the cursor outside the block nothing
 * updated, and with the cursor in a DIFFERENT code block the wrong block
 * updated. The fix targets the node view's own position from getPos().
 */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeText: vi.fn(() => Promise.resolve()),
}));

import { CodeBlockWithLineNumbers } from "../tiptap";

beforeAll(() => {
  // jsdom doesn't implement scrollIntoView (used by the dropdown highlight).
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  // The dropdown mounts on document.body; make sure no stale one leaks.
  document.querySelectorAll(".code-lang-dropdown").forEach((el) => el.remove());
});

function createEditor(content: string) {
  return new Editor({
    extensions: [StarterKit.configure({ codeBlock: false }), CodeBlockWithLineNumbers],
    content,
  });
}

/** Open the dropdown of the `index`-th code block chip and pick `langId`. */
function pickLanguage(editor: Editor, index: number, langId: string): void {
  const chips = editor.view.dom.querySelectorAll(".code-lang-selector");
  const chip = chips[index];
  expect(chip).toBeTruthy();
  chip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

  // The dropdown mounts on the popup host — with no `.editor-container`
  // ancestor (detached test editor) that is the chip's parent element inside
  // the editor DOM, so search both trees.
  const item = [
    ...Array.from(document.querySelectorAll<HTMLElement>(".code-lang-item")),
    ...Array.from(editor.view.dom.querySelectorAll<HTMLElement>(".code-lang-item")),
  ].find((el) => el.dataset.langId === langId);
  expect(item).toBeTruthy();
  item!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function languagesInDoc(editor: Editor): string[] {
  const langs: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.type.name === "codeBlock") langs.push(node.attrs.language);
  });
  return langs;
}

describe("code block language picking (real node view)", () => {
  it("updates the block even when the cursor is outside it", () => {
    const editor = createEditor("<p>intro</p><pre><code>mkdir foo</code></pre>");
    editor.commands.setTextSelection(2); // in the paragraph, NOT the code block

    pickLanguage(editor, 0, "bash");

    expect(languagesInDoc(editor)).toEqual(["bash"]);
    editor.destroy();
  });

  it("updates the clicked block, not the block the cursor is in", () => {
    const editor = createEditor(
      "<pre><code>first block</code></pre><pre><code>second block</code></pre>"
    );
    editor.commands.setTextSelection(3); // inside the FIRST code block

    pickLanguage(editor, 1, "python"); // pick on the SECOND block's chip

    expect(languagesInDoc(editor)).toEqual(["plaintext", "python"]);
    editor.destroy();
  });

  it("updates the chip text after picking", () => {
    const editor = createEditor("<p>intro</p><pre><code>x = 1</code></pre>");
    editor.commands.setTextSelection(2);

    pickLanguage(editor, 0, "python");

    const chip = editor.view.dom.querySelector(".code-lang-selector");
    expect(chip?.textContent).toBe("Python");
    editor.destroy();
  });

  it("opens the dropdown from the keyboard (chip is a focusable button)", () => {
    const editor = createEditor("<p>intro</p><pre><code>x</code></pre>");
    const chip = editor.view.dom.querySelector<HTMLElement>(".code-lang-selector")!;

    expect(chip.getAttribute("role")).toBe("button");
    expect(chip.tabIndex).toBe(0);

    // Unrelated keys must not open it…
    chip.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(document.querySelector(".code-lang-dropdown")).toBeNull();
    expect(editor.view.dom.querySelector(".code-lang-dropdown")).toBeNull();

    // …Enter must.
    chip.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const dropdown =
      document.querySelector(".code-lang-dropdown") ??
      editor.view.dom.querySelector(".code-lang-dropdown");
    expect(dropdown).not.toBeNull();
    editor.destroy();
  });

  it("supports changing the language twice in a row", () => {
    const editor = createEditor("<p>intro</p><pre><code>x</code></pre>");
    editor.commands.setTextSelection(2);

    pickLanguage(editor, 0, "python");
    pickLanguage(editor, 0, "bash");

    expect(languagesInDoc(editor)).toEqual(["bash"]);
    editor.destroy();
  });
});
