/**
 * showInvisibles (CodeMirror) Tests
 *
 * Verifies that the Source-mode show-invisibles plugin renders glyphs
 * for spaces, tabs, soft breaks, and hard breaks when enabled, and is
 * a no-op when disabled.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createShowInvisiblesPlugin, showInvisiblesTheme } from "../showInvisibles";

function mountView(content: string, enabled: boolean): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const state = EditorState.create({
    doc: content,
    extensions: [createShowInvisiblesPlugin(enabled), showInvisiblesTheme],
  });
  return new EditorView({ state, parent });
}

describe("createShowInvisiblesPlugin (disabled)", () => {
  it("returns an empty array when disabled — no plugin attached", () => {
    const ext = createShowInvisiblesPlugin(false);
    expect(Array.isArray(ext)).toBe(true);
    expect((ext as unknown[]).length).toBe(0);
  });

  it("does not render glyph elements when disabled", () => {
    const view = mountView("hello world", false);
    expect(view.dom.querySelectorAll(".cm-invisible").length).toBe(0);
    expect(view.dom.querySelectorAll(".cm-invisible-soft-break").length).toBe(0);
    expect(view.dom.querySelectorAll(".cm-invisible-hard-break").length).toBe(0);
    view.destroy();
  });
});

describe("createShowInvisiblesPlugin (enabled)", () => {
  it("renders a glyph widget for every space character", () => {
    const view = mountView("a b c", true);
    const widgets = view.dom.querySelectorAll(".cm-invisible-space");
    expect(widgets.length).toBe(2);
    expect(widgets[0].textContent).toBe("·");
    view.destroy();
  });

  it("renders a glyph widget for every tab character", () => {
    const view = mountView("a\tb\tc", true);
    const widgets = view.dom.querySelectorAll(".cm-invisible-tab");
    expect(widgets.length).toBe(2);
    expect(widgets[0].textContent).toBe("→");
    view.destroy();
  });

  it("marks soft-break lines (single \\n between paragraphs)", () => {
    const view = mountView("first line\nsecond line", true);
    const softLines = view.dom.querySelectorAll(".cm-invisible-soft-break");
    expect(softLines.length).toBe(1);
    view.destroy();
  });

  it("marks hard-break lines for trailing two-space", () => {
    const view = mountView("first  \nsecond", true);
    const hardLines = view.dom.querySelectorAll(".cm-invisible-hard-break");
    expect(hardLines.length).toBe(1);
    view.destroy();
  });

  it("marks hard-break lines for trailing backslash", () => {
    const view = mountView("first\\\nsecond", true);
    const hardLines = view.dom.querySelectorAll(".cm-invisible-hard-break");
    expect(hardLines.length).toBe(1);
    view.destroy();
  });

  it("marks hard-break lines for trailing <br>", () => {
    const view = mountView("first<br>\nsecond", true);
    const hardLines = view.dom.querySelectorAll(".cm-invisible-hard-break");
    expect(hardLines.length).toBe(1);
    view.destroy();
  });

  it("does not mark the last line (no following line to break to)", () => {
    const view = mountView("only line", true);
    const softLines = view.dom.querySelectorAll(".cm-invisible-soft-break");
    const hardLines = view.dom.querySelectorAll(".cm-invisible-hard-break");
    expect(softLines.length).toBe(0);
    expect(hardLines.length).toBe(0);
    view.destroy();
  });

  it("does not mark blank lines as soft breaks", () => {
    const view = mountView("first\n\nthird", true);
    const softLines = view.dom.querySelectorAll(".cm-invisible-soft-break");
    expect(softLines.length).toBe(1);
    view.destroy();
  });

  it("handles empty document without crashing", () => {
    const view = mountView("", true);
    expect(view.dom.querySelectorAll(".cm-invisible").length).toBe(0);
    view.destroy();
  });

  it("rebuilds decorations after the document changes", () => {
    const view = mountView("ab", true);
    expect(view.dom.querySelectorAll(".cm-invisible-space").length).toBe(0);
    view.dispatch({ changes: { from: 1, insert: " c " } });
    expect(view.dom.querySelectorAll(".cm-invisible-space").length).toBe(2);
    view.destroy();
  });
});
