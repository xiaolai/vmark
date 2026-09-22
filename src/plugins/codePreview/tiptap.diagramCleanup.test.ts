/**
 * Diagram instances die with their editor.
 *
 * Diagram widgets (mermaid pan-zoom, markmap) register destroy callbacks in
 * the window-global diagramCleanup registry. The only other release path is
 * sweepDetached(), which runs in SOME editor's full decoration rebuild — and
 * prose-only documents never reach it. Switching tabs destroys the editor, so
 * without this a document's diagrams (their SVG DOM, and the two `document`
 * listeners each pan-zoom adds) outlived it until an unrelated rebuild.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import StarterKit from "@tiptap/starter-kit";
import { Editor } from "@tiptap/core";
import { codePreviewExtension, __resetActiveEditorViewsForTesting } from "./tiptap";
import {
  registerCleanup,
  _registrySize,
  _clearRegistry,
} from "@/plugins/shared/diagramCleanup";

afterEach(() => {
  _clearRegistry();
  __resetActiveEditorViewsForTesting();
  document.body.replaceChildren();
});

function mountEditor(): Editor {
  const element = document.createElement("div");
  document.body.appendChild(element);
  return new Editor({
    element,
    extensions: [StarterKit, codePreviewExtension],
    content: "<p>prose only</p>",
  });
}

describe("codePreview plugin view — diagram cleanup on editor destroy", () => {
  it("runs the destroy callbacks of diagrams inside the destroyed editor", () => {
    const editor = mountEditor();
    const diagram = document.createElement("div");
    editor.view.dom.appendChild(diagram);
    const destroyDiagram = vi.fn();
    registerCleanup(diagram, destroyDiagram);

    editor.destroy();

    expect(destroyDiagram).toHaveBeenCalledTimes(1);
    expect(_registrySize()).toBe(0);
  });

  it("leaves diagrams owned by another, still-live editor alone", () => {
    const closing = mountEditor();
    const staying = mountEditor();
    const other = document.createElement("div");
    staying.view.dom.appendChild(other);
    const destroyOther = vi.fn();
    registerCleanup(other, destroyOther);

    closing.destroy();

    expect(destroyOther).not.toHaveBeenCalled();
    expect(_registrySize()).toBe(1);
    staying.destroy();
  });
});
