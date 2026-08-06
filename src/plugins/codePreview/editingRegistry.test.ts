import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * These drive the STANDALONE default — the plugin with no host.
 *
 * `src/test/bindPluginRegistries.ts` binds the app store into the shared
 * module instance, so reaching the default needs a fresh one. Hence
 * `resetModules` + dynamic import in `beforeEach` rather than a top-level
 * import: without it these would silently be re-testing the app's store.
 */
let bindBlockMathEditingStore: typeof import("./editingRegistry").bindBlockMathEditingStore;
let blockMathEditing: typeof import("./editingRegistry").blockMathEditing;

beforeEach(async () => {
  vi.resetModules();
  ({ bindBlockMathEditingStore, blockMathEditing } = await import("./editingRegistry"));
});

describe("the editing registry", () => {
  it("starts with nothing being edited", () => {
    const r = blockMathEditing();
    expect(r.getState().editingPos).toBeNull();
    expect(r.getState().isEditingAt(0)).toBe(false);
  });

  it("records the position and the content captured at open", () => {
    const r = blockMathEditing();
    r.getState().startEditing(4, "x^2");
    expect(r.getState().editingPos).toBe(4);
    expect(r.getState().originalContent).toBe("x^2");
    expect(r.getState().isEditingAt(4)).toBe(true);
    expect(r.getState().isEditingAt(5)).toBe(false);
    r.getState().exitEditing();
  });

  it("treats position 0 as a real position, not as absent", () => {
    // `editingPos` is nullable and 0 is falsy — `isEditingAt` must compare
    // against null, not truthiness, or the first block in a document would
    // never register as being edited.
    const r = blockMathEditing();
    r.getState().startEditing(0, "x");
    expect(r.getState().isEditingAt(0)).toBe(true);
    r.getState().exitEditing();
  });

  it("clears both fields on exit", () => {
    const r = blockMathEditing();
    r.getState().startEditing(2, "y");
    r.getState().exitEditing();
    expect(r.getState().editingPos).toBeNull();
    expect(r.getState().originalContent).toBeNull();
  });

  it("supports setState for the position remap, in both forms", () => {
    const r = blockMathEditing();
    r.getState().startEditing(2, "y");
    r.setState({ editingPos: 9 });
    expect(r.getState().editingPos).toBe(9);
    r.setState((s) => ({ editingPos: (s.editingPos ?? 0) + 1 }));
    expect(r.getState().editingPos).toBe(10);
    r.getState().exitEditing();
  });

  it("notifies subscribers and stops on unsubscribe", () => {
    const r = blockMathEditing();
    const listener = vi.fn();
    const unsubscribe = r.subscribe(listener);
    r.getState().startEditing(1, "a");
    expect(listener).toHaveBeenCalled();
    unsubscribe();
    listener.mockClear();
    r.getState().exitEditing();
    expect(listener).not.toHaveBeenCalled();
  });

  it("routes reads to whatever is bound", () => {
    bindBlockMathEditingStore({
      getState: () => ({ editingPos: 42, originalContent: "host" }),
    } as never);
    expect(blockMathEditing().getState().editingPos).toBe(42);
    expect(blockMathEditing().getState().originalContent).toBe("host");
  });
});
