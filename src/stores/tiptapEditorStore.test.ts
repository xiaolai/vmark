import { describe, it, expect, beforeEach } from "vitest";
import { useTiptapEditorStore } from "./tiptapEditorStore";
import type { CursorContext } from "@/plugins/toolbarContext/types";
import type { EditorView } from "@tiptap/pm/view";

const view = {} as EditorView;

function ctx(over: Partial<CursorContext> = {}): CursorContext {
  return {
    hasSelection: false,
    atLineStart: false,
    contextMode: "insert",
    surface: "wysiwyg",
    ...over,
  };
}

beforeEach(() => {
  useTiptapEditorStore.getState().clear();
});

describe("tiptapEditorStore.setContext", () => {
  it("keeps the existing context reference when the new context is structurally equal", () => {
    const first = ctx();
    useTiptapEditorStore.getState().setContext(first, view);
    useTiptapEditorStore.getState().setContext(ctx(), view);
    expect(useTiptapEditorStore.getState().context).toBe(first);
  });

  it("publishes the new context when content changes", () => {
    useTiptapEditorStore.getState().setContext(ctx(), view);
    const changed = ctx({ hasSelection: true });
    useTiptapEditorStore.getState().setContext(changed, view);
    expect(useTiptapEditorStore.getState().context).toBe(changed);
  });

  it("publishes the new context when the editor view changes", () => {
    useTiptapEditorStore.getState().setContext(ctx(), view);
    const view2 = {} as EditorView;
    const same = ctx();
    useTiptapEditorStore.getState().setContext(same, view2);
    expect(useTiptapEditorStore.getState().context).toBe(same);
    expect(useTiptapEditorStore.getState().editorView).toBe(view2);
  });

  it("publishes the first context from the initial null state", () => {
    const first = ctx();
    useTiptapEditorStore.getState().setContext(first, view);
    expect(useTiptapEditorStore.getState().context).toBe(first);
  });
});
