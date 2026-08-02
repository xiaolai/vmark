import { describe, it, expect, vi, afterEach } from "vitest";
import { bindSourcePeekStore, peekStore } from "./peekStore";

/**
 * The unbound path is the plugin standing alone, so these drive the default
 * implementation rather than a stub. `bindSourcePeekStore` is module-level
 * state, so each test that binds must restore the default afterwards.
 */
const DEFAULT = peekStore();
afterEach(() => bindSourcePeekStore(DEFAULT));

const range = { from: 2, to: 8 };

describe("the standalone peek state", () => {
  it("starts closed", () => {
    expect(peekStore().getState().isOpen).toBe(false);
    expect(peekStore().getState().range).toBeNull();
  });

  it("opens with the markdown, range and block type it was given", () => {
    peekStore().getState().open({ markdown: "# Hi", range, blockTypeName: "heading" });
    const s = peekStore().getState();
    expect(s.isOpen).toBe(true);
    expect(s.markdown).toBe("# Hi");
    expect(s.range).toEqual(range);
    expect(s.blockTypeName).toBe("heading");
    peekStore().getState().close();
  });

  it("defaults the block type to null when the caller omits it", () => {
    peekStore().getState().open({ markdown: "x", range });
    expect(peekStore().getState().blockTypeName).toBeNull();
    peekStore().getState().close();
  });

  it("captures the opening markdown as the revert target", () => {
    peekStore().getState().open({ markdown: "original", range });
    peekStore().getState().setMarkdown("edited");
    expect(peekStore().getState().originalMarkdown).toBe("original");
    peekStore().getState().close();
  });

  it("tracks unsaved changes against the revert target, not the last keystroke", () => {
    peekStore().getState().open({ markdown: "a", range });
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    peekStore().getState().setMarkdown("ab");
    expect(peekStore().getState().hasUnsavedChanges).toBe(true);
    // Typing back to the original is NOT a pending change.
    peekStore().getState().setMarkdown("a");
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    peekStore().getState().close();
  });

  it("clears the dirty flag on markSaved without moving the revert target", () => {
    peekStore().getState().open({ markdown: "a", range });
    peekStore().getState().setMarkdown("ab");
    peekStore().getState().markSaved();
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    expect(peekStore().getState().originalMarkdown).toBe("a");
    peekStore().getState().close();
  });

  it("toggles live preview", () => {
    expect(peekStore().getState().livePreview).toBe(false);
    peekStore().getState().toggleLivePreview();
    expect(peekStore().getState().livePreview).toBe(true);
    peekStore().getState().toggleLivePreview();
    expect(peekStore().getState().livePreview).toBe(false);
  });

  it("resets everything on close", () => {
    peekStore().getState().open({ markdown: "x", range, blockTypeName: "paragraph" });
    peekStore().getState().setMarkdown("y");
    peekStore().getState().close();
    const s = peekStore().getState();
    expect(s).toMatchObject({
      isOpen: false,
      range: null,
      markdown: "",
      originalMarkdown: null,
      hasUnsavedChanges: false,
      blockTypeName: null,
    });
  });

  it("accepts a parse error without breaking (the standalone store has no UI for it)", () => {
    expect(() => peekStore().getState().setParseError("bad yaml")).not.toThrow();
  });

  it("supports the setState the range-remap uses, in both object and updater form", () => {
    peekStore().getState().open({ markdown: "x", range });
    peekStore().setState({ range: { from: 5, to: 9 } });
    expect(peekStore().getState().range).toEqual({ from: 5, to: 9 });
    peekStore().setState((s) => ({ markdown: `${s.markdown}!` }));
    expect(peekStore().getState().markdown).toBe("x!");
    peekStore().getState().close();
  });

  it("notifies subscribers with the new and previous state, and stops on unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = peekStore().subscribe(listener);
    peekStore().getState().open({ markdown: "x", range });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ isOpen: true }),
      expect.objectContaining({ isOpen: false })
    );
    unsubscribe();
    listener.mockClear();
    peekStore().getState().close();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("binding", () => {
  it("routes reads to the host's store once bound", () => {
    const hostState = { isOpen: true, markdown: "from host" };
    bindSourcePeekStore({ getState: () => hostState } as never);
    expect(peekStore().getState().isOpen).toBe(true);
    expect(peekStore().getState().markdown).toBe("from host");
  });
});
