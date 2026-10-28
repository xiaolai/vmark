// @vitest-environment node
// WI-AL2.2g — the pending caret-restore record: counted per editor, settled once per begin, never left behind by a double settle.
import { describe, expect, it } from "vitest";
import { beginCaretRestore, isCaretRestorePending } from "./caretRestorePending";

describe("caretRestorePending", () => {
  it("an editor with nothing scheduled is not pending", () => {
    expect(isCaretRestorePending({})).toBe(false);
  });

  it("is pending from begin until settle", () => {
    const editor = {};
    const settle = beginCaretRestore(editor);
    expect(isCaretRestorePending(editor)).toBe(true);
    settle();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("stays pending until every overlapping restore settles", () => {
    const editor = {};
    const mount = beginCaretRestore(editor);
    const show = beginCaretRestore(editor);
    mount();
    expect(isCaretRestorePending(editor)).toBe(true);
    show();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("a second settle of the same restore does not settle another", () => {
    const editor = {};
    const first = beginCaretRestore(editor);
    const second = beginCaretRestore(editor);
    first();
    first();
    expect(isCaretRestorePending(editor)).toBe(true);
    second();
    expect(isCaretRestorePending(editor)).toBe(false);
  });

  it("is per editor", () => {
    const a = {};
    const b = {};
    beginCaretRestore(a);
    expect(isCaretRestorePending(b)).toBe(false);
  });
});
