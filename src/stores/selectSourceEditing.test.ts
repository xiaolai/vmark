import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

const findTabById = vi.fn();
vi.mock("./tabStore", () => ({
  useTabStore: {
    getState: () => ({ activeTabId: { main: "t1" }, findTabById }),
  },
}));

import {
  selectSourceEditing,
  selectEditorMode,
  selectViewMenuModeState,
} from "./selectSourceEditing";

beforeEach(() => {
  findTabById.mockReset().mockReturnValue({ kind: "document", formatId: "markdown" });
});

describe("selectSourceEditing", () => {
  it("is true in Source mode regardless of tab format", () => {
    findTabById.mockReturnValue({ kind: "document", formatId: "json" });
    expect(selectSourceEditing({ sourceMode: true, markdownSplitView: false })).toBe(true);
  });

  it("is true in Split view when the active tab is markdown", () => {
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: true })).toBe(true);
  });

  it("is FALSE in Split view when the active tab is NOT markdown (no misroute)", () => {
    findTabById.mockReturnValue({ kind: "document", formatId: "json" });
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: true })).toBe(false);
  });

  it("is false in plain WYSIWYG", () => {
    expect(selectSourceEditing({ sourceMode: false, markdownSplitView: false })).toBe(false);
  });
});

describe("selectEditorMode (#1070)", () => {
  it("maps neither flag → wysiwyg", () => {
    expect(selectEditorMode({ sourceMode: false, markdownSplitView: false })).toBe("wysiwyg");
  });

  it("maps sourceMode → source", () => {
    expect(selectEditorMode({ sourceMode: true, markdownSplitView: false })).toBe("source");
  });

  it("maps markdownSplitView → split", () => {
    expect(selectEditorMode({ sourceMode: false, markdownSplitView: true })).toBe("split");
  });

  it("defensively prefers source if both flags are somehow set", () => {
    expect(selectEditorMode({ sourceMode: true, markdownSplitView: true })).toBe("source");
  });
});

describe("selectViewMenuModeState (#1070)", () => {
  const wysiwyg = { sourceMode: false, markdownSplitView: false };
  const source = { sourceMode: true, markdownSplitView: false };
  const split = { sourceMode: false, markdownSplitView: true };
  const md = { hasActiveTab: true, isMarkdown: true, forcedSource: false };
  const nonMd = { hasActiveTab: true, isMarkdown: false, forcedSource: false };

  it("markdown WYSIWYG: word wrap disabled, line numbers stay enabled (ADR-5)", () => {
    expect(selectViewMenuModeState(wysiwyg, md)).toEqual({
      mode: "wysiwyg",
      modeApplies: true,
      wordWrapApplies: false,
      lineNumbersApplies: true,
    });
  });

  it("markdown Source: modes apply, both toggles enabled", () => {
    expect(selectViewMenuModeState(source, md)).toEqual({
      mode: "source",
      modeApplies: true,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("markdown Split: modes apply, both toggles enabled", () => {
    expect(selectViewMenuModeState(split, md)).toEqual({
      mode: "split",
      modeApplies: true,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("forced-source markdown tab reads as Source even when flags say WYSIWYG", () => {
    expect(
      selectViewMenuModeState(wysiwyg, { ...md, forcedSource: true }),
    ).toEqual({
      mode: "source",
      modeApplies: true,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("non-markdown tab: modes do NOT apply, toggles stay enabled (CodeMirror)", () => {
    expect(selectViewMenuModeState(wysiwyg, nonMd)).toEqual({
      mode: "wysiwyg",
      modeApplies: false,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("no active tab: nothing applies", () => {
    expect(
      selectViewMenuModeState(wysiwyg, {
        hasActiveTab: false,
        isMarkdown: false,
        forcedSource: false,
      }),
    ).toEqual({
      mode: "wysiwyg",
      modeApplies: false,
      wordWrapApplies: false,
      lineNumbersApplies: false,
    });
  });
});
