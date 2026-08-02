import { describe, it, expect, vi, beforeEach } from "vitest";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const mockGetHeadingInfo = vi.fn();
const mockSetHeadingLevel = vi.fn();
const mockConvertToHeading = vi.fn();
const mockGetListItemInfo = vi.fn();
const mockIndentListItem = vi.fn();
const mockOutdentListItem = vi.fn();
const mockRemoveList = vi.fn();
const mockToBulletList = vi.fn();
const mockToOrderedList = vi.fn();
const mockToTaskList = vi.fn();
const mockGetBlockquoteInfo = vi.fn();
const mockNestBlockquote = vi.fn();
const mockUnnestBlockquote = vi.fn();
const mockRemoveBlockquote = vi.fn();

vi.mock("@/plugins/sourceContextDetection/headingDetection", () => ({
  getHeadingInfo: (...args: unknown[]) => mockGetHeadingInfo(...args),
  setHeadingLevel: (...args: unknown[]) => mockSetHeadingLevel(...args),
  convertToHeading: (...args: unknown[]) => mockConvertToHeading(...args),
}));

vi.mock("@/plugins/sourceContextDetection/listDetection", () => ({
  getListItemInfo: (...args: unknown[]) => mockGetListItemInfo(...args),
  indentListItem: (...args: unknown[]) => mockIndentListItem(...args),
  outdentListItem: (...args: unknown[]) => mockOutdentListItem(...args),
  removeList: (...args: unknown[]) => mockRemoveList(...args),
  toBulletList: (...args: unknown[]) => mockToBulletList(...args),
  toOrderedList: (...args: unknown[]) => mockToOrderedList(...args),
  toTaskList: (...args: unknown[]) => mockToTaskList(...args),
}));

vi.mock("@/plugins/sourceContextDetection/blockquoteDetection", () => ({
  getBlockquoteInfo: (...args: unknown[]) => mockGetBlockquoteInfo(...args),
  nestBlockquote: (...args: unknown[]) => mockNestBlockquote(...args),
  unnestBlockquote: (...args: unknown[]) => mockUnnestBlockquote(...args),
  removeBlockquote: (...args: unknown[]) => mockRemoveBlockquote(...args),
}));

import {
  applyMultiSelectionHeading,
  applyMultiSelectionBlockquoteAction,
} from "./sourceMultiSelection";

function createView(doc: string, ranges: Array<{ from: number; to: number }>): EditorView {
  const parent = document.createElement("div");
  const selection = EditorSelection.create(
    ranges.map((r) => EditorSelection.range(r.from, r.to))
  );
  const state = EditorState.create({
    doc,
    selection,
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
  return new EditorView({ state, parent });
}

describe("applyMultiSelectionHeading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for single selection", () => {
    const view = createView("hello", [{ from: 0, to: 0 }]);
    const result = applyMultiSelectionHeading(view, 1);
    expect(result).toBe(false);
    view.destroy();
  });

  it("applies heading to each range in descending order", () => {
    const view = createView("line1\nline2\nline3", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
      { from: 12, to: 12 },
    ]);

    mockGetHeadingInfo.mockReturnValue(null);
    applyMultiSelectionHeading(view, 2);

    // Should be called for each range
    expect(mockConvertToHeading).toHaveBeenCalledTimes(3);
    view.destroy();
  });

  it("uses setHeadingLevel when heading info exists", () => {
    const view = createView("# line1\n# line2", [
      { from: 2, to: 2 },
      { from: 10, to: 10 },
    ]);

    const headingInfo = { level: 1, from: 0, to: 7 };
    mockGetHeadingInfo.mockReturnValue(headingInfo);
    applyMultiSelectionHeading(view, 2);

    expect(mockSetHeadingLevel).toHaveBeenCalled();
    expect(mockConvertToHeading).not.toHaveBeenCalled();
    view.destroy();
  });

  it("does not convert to heading when level is 0 and no existing heading", () => {
    const view = createView("line1\nline2", [
      { from: 0, to: 0 },
      { from: 6, to: 6 },
    ]);

    mockGetHeadingInfo.mockReturnValue(null);
    applyMultiSelectionHeading(view, 0);

    expect(mockConvertToHeading).not.toHaveBeenCalled();
    expect(mockSetHeadingLevel).not.toHaveBeenCalled();
    view.destroy();
  });
});

describe("applyMultiSelectionBlockquoteAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false for single selection", () => {
    const view = createView("> quote", [{ from: 2, to: 2 }]);
    const result = applyMultiSelectionBlockquoteAction(view, "nestBlockquote");
    expect(result).toBe(false);
    view.destroy();
  });

  it("returns false when no ranges have blockquote info", () => {
    const view = createView("one\ntwo", [
      { from: 0, to: 0 },
      { from: 4, to: 4 },
    ]);
    mockGetBlockquoteInfo.mockReturnValue(null);
    const result = applyMultiSelectionBlockquoteAction(view, "nestBlockquote");
    expect(result).toBe(false);
    view.destroy();
  });

  it("nests blockquotes for each range", () => {
    const view = createView("> one\n> two", [
      { from: 2, to: 2 },
      { from: 8, to: 8 },
    ]);
    const info = { depth: 1 };
    mockGetBlockquoteInfo.mockReturnValue(info);
    applyMultiSelectionBlockquoteAction(view, "nestBlockquote");
    expect(mockNestBlockquote).toHaveBeenCalledTimes(2);
    view.destroy();
  });

  it("unnests blockquotes for each range", () => {
    const view = createView(">> one\n>> two", [
      { from: 3, to: 3 },
      { from: 10, to: 10 },
    ]);
    const info = { depth: 2 };
    mockGetBlockquoteInfo.mockReturnValue(info);
    applyMultiSelectionBlockquoteAction(view, "unnestBlockquote");
    expect(mockUnnestBlockquote).toHaveBeenCalledTimes(2);
    view.destroy();
  });

  it("removes blockquotes for each range", () => {
    const view = createView("> one\n> two", [
      { from: 2, to: 2 },
      { from: 8, to: 8 },
    ]);
    const info = { depth: 1 };
    mockGetBlockquoteInfo.mockReturnValue(info);
    applyMultiSelectionBlockquoteAction(view, "removeBlockquote");
    expect(mockRemoveBlockquote).toHaveBeenCalledTimes(2);
    view.destroy();
  });

  it("returns false for unknown action", () => {
    const view = createView("> one\n> two", [
      { from: 2, to: 2 },
      { from: 8, to: 8 },
    ]);
    const info = { depth: 1 };
    mockGetBlockquoteInfo.mockReturnValue(info);
    const result = applyMultiSelectionBlockquoteAction(view, "unknownAction");
    expect(result).toBe(false);
    view.destroy();
  });
});
