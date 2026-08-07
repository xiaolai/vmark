// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { createInlineMathEditingRegistry } from "./inlineMathEditingRegistry";

const callbacks = (forceExit = vi.fn()) => ({ forceExit, getNodePos: () => 0 });

describe("createInlineMathEditingRegistry", () => {
  it("reports nothing being edited to start with", () => {
    expect(createInlineMathEditingRegistry().isEditingAt(3)).toBe(false);
  });

  it("reports the position it was started at", () => {
    const r = createInlineMathEditingRegistry();
    r.startEditing(3, callbacks());
    expect(r.isEditingAt(3)).toBe(true);
    expect(r.isEditingAt(4)).toBe(false);
  });

  it("force-exits the previous editor when a different node starts", () => {
    const r = createInlineMathEditingRegistry();
    const first = vi.fn();
    r.startEditing(3, callbacks(first));
    r.startEditing(9, callbacks());
    expect(first).toHaveBeenCalledTimes(1);
    expect(r.isEditingAt(9)).toBe(true);
    expect(r.isEditingAt(3)).toBe(false);
  });

  it("does not force-exit when the SAME node re-starts", () => {
    // A node view re-entering its own editor must not tear itself down.
    const r = createInlineMathEditingRegistry();
    const forceExit = vi.fn();
    r.startEditing(3, callbacks(forceExit));
    r.startEditing(3, callbacks(forceExit));
    expect(forceExit).not.toHaveBeenCalled();
    expect(r.isEditingAt(3)).toBe(true);
  });

  it("clears on stopEditing at the editing position", () => {
    const r = createInlineMathEditingRegistry();
    r.startEditing(3, callbacks());
    r.stopEditing(3);
    expect(r.isEditingAt(3)).toBe(false);
  });

  it("ignores a stop for a position that is not the one being edited", () => {
    // The guard that matters: a destroyed node at an old position must not
    // close an editor that has since opened elsewhere.
    const r = createInlineMathEditingRegistry();
    r.startEditing(9, callbacks());
    r.stopEditing(3);
    expect(r.isEditingAt(9)).toBe(true);
  });

  it("treats clear as stopEditing, with the same position guard", () => {
    const r = createInlineMathEditingRegistry();
    r.startEditing(9, callbacks());
    r.clear(3);
    expect(r.isEditingAt(9)).toBe(true);
    r.clear(9);
    expect(r.isEditingAt(9)).toBe(false);
  });

  it("tolerates a stop before anything started", () => {
    expect(() => createInlineMathEditingRegistry().stopEditing(0)).not.toThrow();
  });

  it("treats position 0 as a real position, not as absent", () => {
    // `editingNodePos` is nullable and 0 is falsy — the guard must compare
    // against null, not truthiness.
    const r = createInlineMathEditingRegistry();
    r.startEditing(0, callbacks());
    expect(r.isEditingAt(0)).toBe(true);
    const second = vi.fn();
    r.startEditing(0, callbacks(second));
    expect(second).not.toHaveBeenCalled();
  });

  it("keeps two registries independent", () => {
    const a = createInlineMathEditingRegistry();
    const b = createInlineMathEditingRegistry();
    a.startEditing(3, callbacks());
    expect(b.isEditingAt(3)).toBe(false);
  });
});
