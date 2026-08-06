/**
 * WI-1.4 — editor IME composition sessions in REAL WebKit.
 *
 * The first editor-level `*.webkit.test.ts`: until this file, the real-WebKit
 * tier guarded only the terminal. A session is a scripted object —
 * `compose(session, steps…)` — in the codemirror `webtest-composition.ts` /
 * MarkText shape: dispatch `compositionstart`, mutate the REAL DOM text node
 * and fire `input` per update, then `compositionend` (or cancel). Synthetic
 * composition is the ecosystem ceiling for WebKit under any automation
 * framework (no CDP, `textInputController` locked in WebKitTestRunner); the
 * REAL macOS input method is exercised by the opt-in WI-5.2 lane, and the
 * shipping WKWebView by the WI-1.5 journey.
 *
 * Two-surface taxonomy audit (AppFlowy IME suite + WebKit
 * LayoutTests/editing/input, per WI-1.4 DoD):
 *
 * | Taxonomy row                    | Editor (this file)            | Terminal gate |
 * |---------------------------------|-------------------------------|---------------|
 * | composing-region update         | hiragana ｓ→す→すｓ→すし case  | covered (setupImeCompositionGate.webkit) |
 * | delete-during-composition       | shrink-update case            | covered (gate suite) |
 * | commit replaces marked text     | 你好 commit case              | covered (single-writer assert) |
 * | cancel restores document        | Escape-cancel case            | covered (gate suite) |
 * | non-text update (attrs only)    | N/A — ProseMirror text has no composing attrs; nothing to update | N/A (PTY bytes only) |
 * | update-vs-insert ambiguity      | post-commit ASCII case (no leakage) | covered (noteExternalWrite dedup) |
 *
 * Manual real-OS-IME release checklist (the residue neither automated tier
 * covers — candidate-window visuals and IME-specific quirks):
 *   1. macOS Pinyin (maintainer machines: 微软双拼): compose nihk/`m;tm`,
 *      Space-commit → 你好/明天 in the document; save; bytes correct.
 *   2. Esc mid-composition → document unchanged, no stray marked text.
 *   3. Backspace mid-composition removes one keystroke, not one syllable.
 *   4. Hiragana: compose すし, Return commits; no double-insert.
 *
 * @coordinates-with typingHarness.ts — jsdom counterpart (no composition there)
 * @coordinates-with src/components/Terminal/setupImeCompositionGate.webkit.test.ts — terminal surface
 * @module test/editorComposition.webkit.test
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Editor } from "@tiptap/core";
import { createTiptapExtensions } from "@/services/assembly/tiptapExtensions";
import { serializeMarkdown } from "@/utils/markdownPipeline/adapter";

let editor: Editor;
let host: HTMLElement;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  editor = new Editor({ element: host, extensions: createTiptapExtensions() });
  editor.view.focus();
});

afterEach(() => {
  editor.destroy();
  host.remove();
});

const flush = () => new Promise((r) => setTimeout(r, 20));

/** The editable paragraph element at the caret. */
function caretBlock(): HTMLElement {
  const { node } = editor.view.domAtPos(editor.state.selection.from);
  const el = node instanceof HTMLElement ? node : node.parentElement!;
  return el.closest("p, h1, h2, h3, h4, h5, h6, pre") as HTMLElement;
}

interface CompositionSession {
  update(text: string): Promise<void>;
  commit(text: string): Promise<void>;
  cancel(): Promise<void>;
}

/**
 * Start a scripted composition at the caret. Each update mutates the real
 * text node (what the OS IME does to marked text) and fires `input` with
 * `isComposing: true`; commit/cancel fire `compositionend`.
 */
async function startComposition(): Promise<CompositionSession> {
  const block = caretBlock();
  block.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
  await flush();

  // Capture the caret's DOM location NOW: marked text is inserted where the
  // caret is, splitting an existing text node when mid-text — appending at
  // the block end instead makes the reconciler read a tail replacement.
  const caretDom = editor.view.domAtPos(editor.state.selection.from);
  let textNode: Text | null = null;
  const setMarkedText = async (text: string) => {
    if (!textNode || !textNode.isConnected) {
      textNode = document.createTextNode(text);
      if (caretDom.node instanceof Text) {
        const tail = caretDom.node.splitText(caretDom.offset);
        tail.parentNode!.insertBefore(textNode, tail);
      } else if (caretDom.node.childNodes.length > caretDom.offset) {
        caretDom.node.insertBefore(textNode, caretDom.node.childNodes[caretDom.offset]);
      } else {
        caretDom.node.appendChild(textNode);
      }
    } else {
      textNode.data = text;
    }
    const sel = window.getSelection()!;
    sel.collapse(textNode, text.length);
    block.dispatchEvent(
      new InputEvent("input", { bubbles: true, inputType: "insertCompositionText", data: text }),
    );
    await flush();
  };

  return {
    async update(text: string) {
      block.dispatchEvent(
        new CompositionEvent("compositionupdate", { bubbles: true, data: text }),
      );
      await setMarkedText(text);
    },
    async commit(text: string) {
      await setMarkedText(text);
      block.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: text }));
      await flush();
    },
    async cancel() {
      if (textNode && textNode.isConnected) textNode.remove();
      block.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
      await flush();
    },
  };
}

describe("editor composition sessions (real WebKit)", () => {
  it("a multi-step hiragana composition survives every update and commits once", async () => {
    const session = await startComposition();
    for (const step of ["ｓ", "す", "すｓ", "すし"]) {
      await session.update(step);
      // The composition must survive the update: the view stays in
      // composition mode instead of prematurely normalizing the DOM.
      expect(editor.view.composing, `composing during "${step}"`).toBe(true);
    }
    await session.commit("すし");
    expect(editor.view.composing).toBe(false);
    expect(editor.state.doc.textContent).toBe("すし");
  });

  it("a committed CJK composition lands in the document AND serializes correctly", async () => {
    const session = await startComposition();
    await session.update("nihao");
    await session.commit("你好");
    expect(editor.state.doc.textContent).toBe("你好");
    expect(serializeMarkdown(editor.schema, editor.state.doc)).toBe("你好\n");
  });

  it("delete-during-composition: a shrinking update is honored, then commits", async () => {
    const session = await startComposition();
    await session.update("すし");
    await session.update("す"); // one keystroke deleted mid-composition
    await session.commit("す");
    expect(editor.state.doc.textContent).toBe("す");
  });

  it("a cancelled composition leaves the document unchanged", async () => {
    const session = await startComposition();
    await session.update("す");
    await session.cancel();
    expect(editor.state.doc.textContent).toBe("");
    expect(serializeMarkdown(editor.schema, editor.state.doc)).toBe("");
  });

  it("ASCII typed after a commit does not duplicate or interleave (update-vs-insert)", async () => {
    const session = await startComposition();
    await session.update("你");
    await session.commit("你");
    editor.commands.insertContent("ab");
    await flush();
    expect(editor.state.doc.textContent).toBe("你ab");
  });

  it("composition inside existing text keeps the surrounding text intact", async () => {
    editor.commands.insertContent("before after");
    editor.commands.setTextSelection(7); // between "before" and " after"
    await flush();
    const session = await startComposition();
    await session.update("中");
    await session.commit("中");
    expect(editor.state.doc.textContent).toContain("中");
    expect(editor.state.doc.textContent).toContain("before");
    expect(editor.state.doc.textContent).toContain("after");
  });
});
