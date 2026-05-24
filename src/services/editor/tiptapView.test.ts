import { describe, expect, it } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { getTiptapEditorDom, getTiptapEditorView } from "./tiptapView";

describe("getTiptapEditorView", () => {
  it("returns null for a null editor", () => {
    expect(getTiptapEditorView(null)).toBeNull();
  });

  it("returns null when the editor view getter throws", () => {
    const editor = {} as TiptapEditor;
    Object.defineProperty(editor, "view", {
      get() {
        throw new Error("no view");
      },
    });

    expect(getTiptapEditorView(editor)).toBeNull();
  });

  it("returns the editor view when available", () => {
    const view = {} as EditorView;
    const editor = { view } as TiptapEditor;

    expect(getTiptapEditorView(editor)).toBe(view);
  });
});

describe("getTiptapEditorDom", () => {
  it("returns null for a null view", () => {
    expect(getTiptapEditorDom(null)).toBeNull();
  });

  it("returns null when the dom getter throws", () => {
    const view = {} as EditorView;
    Object.defineProperty(view, "dom", {
      get() {
        throw new Error("no dom");
      },
    });

    expect(getTiptapEditorDom(view)).toBeNull();
  });

  it("returns null when the dom is not connected", () => {
    const dom = document.createElement("div");
    const view = { dom } as unknown as EditorView;

    expect(getTiptapEditorDom(view)).toBeNull();
  });

  it("returns the dom when connected", () => {
    const dom = document.createElement("div");
    document.body.appendChild(dom);
    const view = { dom } as unknown as EditorView;

    expect(getTiptapEditorDom(view)).toBe(dom);

    dom.remove();
  });
});
