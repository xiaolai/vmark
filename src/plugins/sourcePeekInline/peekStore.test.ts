import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * These drive the STANDALONE default — the plugin with no host.
 *
 * `src/test/bindPluginRegistries.ts` binds the app store into the shared
 * module instance during setup, which runs BEFORE this module loads. An
 * earlier version captured `peekStore()` at import and so tested Zustand
 * rather than the implementation here — which is how a four-way semantic
 * divergence from the app store went unnoticed. Hence `resetModules` plus a
 * dynamic import per test.
 */
let bindSourcePeekStore: typeof import("./peekStore").bindSourcePeekStore;
let peekStore: typeof import("./peekStore").peekStore;

beforeEach(async () => {
  vi.resetModules();
  ({ bindSourcePeekStore, peekStore } = await import("./peekStore"));
});

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

  it("tracks unsaved changes against the SAVED baseline", () => {
    peekStore().getState().open({ markdown: "a", range });
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    peekStore().getState().setMarkdown("ab");
    expect(peekStore().getState().hasUnsavedChanges).toBe(true);
    // Typing back to the baseline is NOT a pending change.
    peekStore().getState().setMarkdown("a");
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    peekStore().getState().close();
  });

  it("markSaved rebaselines the dirty check but not the revert target", () => {
    // The case an earlier version of this test got wrong, and the reason the
    // two baselines are separate fields: after a save, the dirty check must
    // compare against the SAVED content, while revert still goes back to what
    // the peek opened with.
    peekStore().getState().open({ markdown: "a", range });
    peekStore().getState().setMarkdown("ab");
    peekStore().getState().markSaved();
    expect(peekStore().getState().hasUnsavedChanges).toBe(false);
    expect(peekStore().getState().savedMarkdown).toBe("ab");
    expect(peekStore().getState().originalMarkdown).toBe("a");

    // Typing back to the ORIGINAL is now a pending change, because "ab" is
    // what is on disk. The old code reported it clean.
    peekStore().getState().setMarkdown("a");
    expect(peekStore().getState().hasUnsavedChanges).toBe(true);
    peekStore().getState().close();
  });

  it("stores a parse error and clears it on the next edit", () => {
    peekStore().getState().open({ markdown: "a", range });
    peekStore().getState().setParseError("bad yaml");
    expect(peekStore().getState().parseError).toBe("bad yaml");
    peekStore().getState().setMarkdown("ab");
    expect(peekStore().getState().parseError).toBeNull();
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
      savedMarkdown: null,
      parseError: null,
      hasUnsavedChanges: false,
      blockTypeName: null,
    });
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
