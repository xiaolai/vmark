// WI-FL5.1 — useTiptapSettingsSync: a settings change reaches the LIVE Tiptap
// instance (ledger F7, editor-lifecycle-hooks). Real editor, real plugin: the
// assertions are about what the document/plugin state looks like afterwards,
// not about which helper was called.
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { undoDepth } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";
import { showInvisiblesExtension, showInvisiblesPluginKey } from "@/plugins/showInvisibles/tiptap";
import { useTiptapSettingsSync } from "./useTiptapSettingsSync";

let editors: Editor[] = [];

function createEditor(content = "<p>a b c</p>"): Editor {
  const editor = new Editor({ extensions: [StarterKit, showInvisiblesExtension], content });
  editors.push(editor);
  return editor;
}

afterEach(() => {
  for (const editor of editors) editor.destroy();
  editors = [];
});

const BASE = { showInvisibles: false, cjkLetterSpacing: "0", readOnly: false };

/** How many invisible-character widgets the plugin currently paints. */
function invisibleCount(editor: Editor): number {
  return showInvisiblesPluginKey.getState(editor.state)?.find().length ?? 0;
}

describe("useTiptapSettingsSync — show invisibles", () => {
  it("turning the setting on paints one widget per space in the live document; off clears them", () => {
    const editor = createEditor("<p>a b c</p>");
    const { rerender } = renderHook((props) => useTiptapSettingsSync(editor, props), {
      initialProps: BASE,
    });
    expect(invisibleCount(editor)).toBe(0);

    rerender({ ...BASE, showInvisibles: true });
    expect(invisibleCount(editor)).toBe(2); // "a b c" has two spaces

    rerender({ ...BASE, showInvisibles: false });
    expect(invisibleCount(editor)).toBe(0);
  });

  it("keeps painting on later edits — the storage flag, not just a one-off rebuild, was flipped", () => {
    const editor = createEditor("<p>a b c</p>");
    const { rerender } = renderHook((props) => useTiptapSettingsSync(editor, props), {
      initialProps: BASE,
    });
    rerender({ ...BASE, showInvisibles: true });

    // A keystroke after the toggle: the plugin's incremental path reads its
    // storage flag, so a stale flag would paint nothing for the new space.
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " d");
    expect(editor.getText()).toBe("a b c d");
    expect(invisibleCount(editor)).toBe(3);

    // And after turning it off, a further keystroke paints nothing at all.
    rerender({ ...BASE, showInvisibles: false });
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, " e");
    expect(invisibleCount(editor)).toBe(0);
  });
});

describe("useTiptapSettingsSync — CJK letter spacing", () => {
  it("a spacing change dispatches a tagged transaction that leaves the document and undo history alone", () => {
    const editor = createEditor("<p>中文 text</p>");
    const seen: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => {
      seen.push(transaction);
    });
    const { rerender } = renderHook((props) => useTiptapSettingsSync(editor, props), {
      initialProps: BASE,
    });
    const before = seen.length;

    rerender({ ...BASE, cjkLetterSpacing: "0.05em" });

    const tagged = seen.slice(before).filter((tr) => tr.getMeta("cjkLetterSpacingChanged") === true);
    expect(tagged).toHaveLength(1);
    expect(tagged[0].getMeta("addToHistory")).toBe(false);
    expect(tagged[0].docChanged).toBe(false);
    expect(editor.getText()).toBe("中文 text");
    expect(undoDepth(editor.state)).toBe(0); // a settings change is not an edit
  });

  it("a re-render with the same spacing does not dispatch again", () => {
    const editor = createEditor();
    const seen: Transaction[] = [];
    editor.on("transaction", ({ transaction }) => {
      seen.push(transaction);
    });
    const { rerender } = renderHook((props) => useTiptapSettingsSync(editor, props), {
      initialProps: BASE,
    });
    const before = seen.length;

    rerender({ ...BASE });
    rerender({ ...BASE });

    expect(seen.slice(before).filter((tr) => tr.getMeta("cjkLetterSpacingChanged"))).toHaveLength(0);
  });
});

describe("useTiptapSettingsSync — read-only", () => {
  it("toggles editability on the live instance without emitting a content update", () => {
    const editor = createEditor();
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    const { rerender } = renderHook((props) => useTiptapSettingsSync(editor, props), {
      initialProps: BASE,
    });
    expect(editor.isEditable).toBe(true);

    rerender({ ...BASE, readOnly: true });
    expect(editor.isEditable).toBe(false);

    rerender({ ...BASE, readOnly: false });
    expect(editor.isEditable).toBe(true);
    expect(onUpdate).not.toHaveBeenCalled(); // setEditable(..., emitUpdate=false)
  });
});

describe("useTiptapSettingsSync — no editor yet", () => {
  it("is a no-op while the editor is null and starts syncing once one arrives", () => {
    type Props = { editor: Editor | null } & typeof BASE;
    const initialProps: Props = { editor: null, ...BASE, showInvisibles: true, readOnly: true };
    const { rerender } = renderHook(
      ({ editor, ...props }: Props) => useTiptapSettingsSync(editor, props),
      { initialProps },
    );

    const editor = createEditor("<p>x y</p>");
    rerender({ ...initialProps, editor });

    expect(invisibleCount(editor)).toBe(1);
    expect(editor.isEditable).toBe(false);
  });
});
