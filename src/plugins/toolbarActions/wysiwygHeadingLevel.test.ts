import { describe, it, expect, vi } from "vitest";
import type { Editor as TiptapEditor } from "@tiptap/core";
import {
  getCurrentHeadingLevel,
  increaseHeadingLevel,
  decreaseHeadingLevel,
} from "./wysiwygHeadingLevel";

/**
 * A minimal editor whose chain reports what ProseMirror decided. `run()` is the
 * editor's verdict on whether the conversion actually applied — reporting
 * success when it returned false told the dispatcher an action happened that
 * did not.
 */
function editorAt(headingLevel: number | null, runResult: boolean) {
  const run = vi.fn(() => runResult);
  const chain = {
    focus: () => chain,
    setHeading: vi.fn(() => chain),
    setParagraph: vi.fn(() => chain),
    run,
  };
  return {
    editor: {
      state: {
        selection: {
          $from: {
            parent:
              headingLevel === null
                ? { type: { name: "paragraph" }, attrs: {} }
                : { type: { name: "heading" }, attrs: { level: headingLevel } },
          },
        },
      },
      chain: () => chain,
    } as unknown as TiptapEditor,
    chain,
    run,
  };
}

describe("getCurrentHeadingLevel", () => {
  it("reads the level of a heading", () => {
    expect(getCurrentHeadingLevel(editorAt(3, true).editor)).toBe(3);
  });

  it("returns null for a paragraph", () => {
    expect(getCurrentHeadingLevel(editorAt(null, true).editor)).toBeNull();
  });
});

describe("heading level stepping returns ProseMirror's verdict", () => {
  it.each([
    { level: null, next: 1 },
    { level: 1, next: 2 },
    { level: 5, next: 6 },
  ])("increase from $level converts to H$next and reports success", ({ level, next }) => {
    const { editor, chain } = editorAt(level, true);
    expect(increaseHeadingLevel(editor)).toBe(true);
    expect(chain.setHeading).toHaveBeenCalledWith({ level: next });
  });

  it("increase clamps at H6 without dispatching", () => {
    const { editor, run } = editorAt(6, true);
    expect(increaseHeadingLevel(editor)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("increase reports FAILURE when the editor rejects the conversion", () => {
    // e.g. the schema forbids a heading at this position. Claiming success left
    // the dispatcher believing an action applied that did not.
    const { editor } = editorAt(null, false);
    expect(increaseHeadingLevel(editor)).toBe(false);
  });

  it("increase mid-range reports the editor's rejection too", () => {
    const { editor } = editorAt(2, false);
    expect(increaseHeadingLevel(editor)).toBe(false);
  });

  it.each([
    { level: 6, next: 5 },
    { level: 2, next: 1 },
  ])("decrease from H$level converts to H$next", ({ level, next }) => {
    const { editor, chain } = editorAt(level, true);
    expect(decreaseHeadingLevel(editor)).toBe(true);
    expect(chain.setHeading).toHaveBeenCalledWith({ level: next });
  });

  it("decrease from H1 becomes a paragraph", () => {
    const { editor, chain } = editorAt(1, true);
    expect(decreaseHeadingLevel(editor)).toBe(true);
    expect(chain.setParagraph).toHaveBeenCalled();
  });

  it("decrease clamps on a paragraph without dispatching", () => {
    const { editor, run } = editorAt(null, true);
    expect(decreaseHeadingLevel(editor)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("decrease reports FAILURE when the editor rejects the conversion", () => {
    const { editor } = editorAt(3, false);
    expect(decreaseHeadingLevel(editor)).toBe(false);
  });

  it("decrease to paragraph reports the editor's rejection too", () => {
    const { editor } = editorAt(1, false);
    expect(decreaseHeadingLevel(editor)).toBe(false);
  });
});
