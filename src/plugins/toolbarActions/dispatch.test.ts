// WI-1.5 — shared mode-branching dispatch helper. Verifies routing to the
// correct adapter per surface, the heading:N special case, context
// construction from editorStore, and the malformed-action guard.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  performWysiwygToolbarAction: vi.fn(() => true),
  performSourceToolbarAction: vi.fn(() => true),
  setWysiwygHeadingLevel: vi.fn(() => true),
  setSourceHeadingLevel: vi.fn(() => true),
  getWysiwygMultiSelectionContext: vi.fn(() => undefined),
  getSourceMultiSelectionContext: vi.fn(() => undefined),
}));

vi.mock("./wysiwygAdapter", () => ({
  performWysiwygToolbarAction: mocks.performWysiwygToolbarAction,
  setWysiwygHeadingLevel: mocks.setWysiwygHeadingLevel,
}));
vi.mock("./sourceAdapter", () => ({
  performSourceToolbarAction: mocks.performSourceToolbarAction,
  setSourceHeadingLevel: mocks.setSourceHeadingLevel,
}));
vi.mock("./multiSelectionContext", () => ({
  getWysiwygMultiSelectionContext: mocks.getWysiwygMultiSelectionContext,
  getSourceMultiSelectionContext: mocks.getSourceMultiSelectionContext,
}));

import { dispatchEditorAction } from "./dispatch";
import { useEditorStore } from "@/stores/editorStore";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dispatchEditorAction", () => {
  it("routes plain actions to the WYSIWYG adapter with a wysiwyg context", () => {
    const result = dispatchEditorAction("bold", "wysiwyg");
    expect(result).toBe(true);
    expect(mocks.performWysiwygToolbarAction).toHaveBeenCalledWith(
      "bold",
      expect.objectContaining({ surface: "wysiwyg" })
    );
    expect(mocks.performSourceToolbarAction).not.toHaveBeenCalled();
  });

  it("routes plain actions to the source adapter with a source context", () => {
    dispatchEditorAction("italic", "source");
    expect(mocks.performSourceToolbarAction).toHaveBeenCalledWith(
      "italic",
      expect.objectContaining({ surface: "source" })
    );
    expect(mocks.performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("routes heading:N to the per-surface heading setter with the parsed level", () => {
    dispatchEditorAction("heading:3", "wysiwyg");
    expect(mocks.setWysiwygHeadingLevel).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "wysiwyg" }),
      3
    );

    dispatchEditorAction("heading:0", "source");
    expect(mocks.setSourceHeadingLevel).toHaveBeenCalledWith(
      expect.objectContaining({ surface: "source" }),
      0
    );
  });

  it("rejects malformed heading actions without dispatching", () => {
    expect(dispatchEditorAction("heading:x", "wysiwyg")).toBe(false);
    expect(mocks.setWysiwygHeadingLevel).not.toHaveBeenCalled();
    expect(mocks.performWysiwygToolbarAction).not.toHaveBeenCalled();
  });

  it("builds the context from the current editorStore state", () => {
    const fakeView = { fake: true };
    const fakeContext = { hasSelection: true };
    useEditorStore.setState((s) => ({
      source: { ...s.source, editorView: fakeView as never, context: fakeContext as never },
    }));
    dispatchEditorAction("bold", "source");
    expect(mocks.performSourceToolbarAction).toHaveBeenCalledWith(
      "bold",
      expect.objectContaining({ view: fakeView, context: fakeContext })
    );
  });

  it("returns the adapter's result", () => {
    mocks.performWysiwygToolbarAction.mockReturnValueOnce(false);
    expect(dispatchEditorAction("bold", "wysiwyg")).toBe(false);
  });
});
