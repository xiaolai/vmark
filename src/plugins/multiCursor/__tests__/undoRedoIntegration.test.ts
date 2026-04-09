/**
 * Multi-cursor undo/redo integration tests with ProseMirror history plugin.
 *
 * Verifies that:
 * 1. Multi-cursor edits undo as a single atomic step
 * 2. Undo restores MultiSelection correctly (via getBookmark/resolve roundtrip)
 * 3. Redo re-applies both document content and MultiSelection
 * 4. Multiple sequential multi-cursor edits produce incremental undo
 */

import { describe, it, expect } from "vitest";
import { Schema } from "@tiptap/pm/model";
import { EditorState, SelectionRange } from "@tiptap/pm/state";
import { history, undo, redo } from "@tiptap/pm/history";
import { MultiSelection } from "../MultiSelection";
import { multiCursorPlugin } from "../multiCursorPlugin";
import { handleMultiCursorInput } from "../inputHandling";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] },
    text: { inline: true },
  },
});

function createDoc(...texts: string[]) {
  return schema.node(
    "doc",
    null,
    texts.map((t) =>
      schema.node("paragraph", null, t ? [schema.text(t)] : [])
    )
  );
}

function createState(doc: ReturnType<typeof createDoc>) {
  return EditorState.create({
    doc,
    plugins: [multiCursorPlugin(), history()],
  });
}

function makeMultiSelection(state: EditorState, positions: number[]): MultiSelection {
  const ranges = positions.map((pos) => {
    const $pos = state.doc.resolve(pos);
    return new SelectionRange($pos, $pos);
  });
  return new MultiSelection(ranges, positions.length - 1);
}

function getDocText(state: EditorState): string {
  const texts: string[] = [];
  state.doc.forEach((node) => {
    texts.push(node.textContent);
  });
  return texts.join("\n");
}

describe("multi-cursor undo/redo integration with history()", () => {
  it("undoes multi-cursor insert as a single step", () => {
    let state = createState(createDoc("hello world"));
    // Place cursors at positions 1 and 7 (after 'h' and after 'w')
    const multiSel = makeMultiSelection(state, [1, 7]);
    state = state.apply(state.tr.setSelection(multiSel));

    // Type "X" at all cursors
    const inputTr = handleMultiCursorInput(state, "X");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);
    expect(getDocText(state)).toBe("Xhello Xworld");

    // Undo should revert both insertions in one step
    const undoResult = undo(state, (tr) => { state = state.apply(tr); });
    expect(undoResult).toBe(true);
    expect(getDocText(state)).toBe("hello world");
  });

  it("redo restores multi-cursor edit and selection after undo", () => {
    let state = createState(createDoc("abc"));
    const multiSel = makeMultiSelection(state, [1, 2, 3]);
    state = state.apply(state.tr.setSelection(multiSel));

    const inputTr = handleMultiCursorInput(state, "X");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);
    expect(getDocText(state)).toBe("XaXbXc");

    // Undo — should restore original MultiSelection
    undo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("abc");
    expect(state.selection).toBeInstanceOf(MultiSelection);
    const afterUndo = state.selection as MultiSelection;
    expect(afterUndo.ranges).toHaveLength(3);
    expect(afterUndo.ranges[0].$from.pos).toBe(1);
    expect(afterUndo.ranges[1].$from.pos).toBe(2);
    expect(afterUndo.ranges[2].$from.pos).toBe(3);

    // Redo — should restore the post-edit MultiSelection
    redo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("XaXbXc");
    expect(state.selection).toBeInstanceOf(MultiSelection);
    const afterRedo = state.selection as MultiSelection;
    expect(afterRedo.ranges).toHaveLength(3);
  });

  it("multiple sequential edits produce incremental undo", () => {
    let state = createState(createDoc("ab"));
    const multiSel = makeMultiSelection(state, [1, 2]);
    state = state.apply(state.tr.setSelection(multiSel));

    // First edit: type "X"
    let inputTr = handleMultiCursorInput(state, "X");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);
    expect(getDocText(state)).toBe("XaXb");

    // Second edit: type "Y" (cursors shifted to 2, 4)
    const multiSel2 = makeMultiSelection(state, [2, 4]);
    state = state.apply(state.tr.setSelection(multiSel2));
    inputTr = handleMultiCursorInput(state, "Y");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);
    expect(getDocText(state)).toBe("XYaXYb");

    // First undo: revert "Y" insertions
    undo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("XaXb");

    // Second undo: revert "X" insertions
    undo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("ab");
  });

  it("undo restores MultiSelection with correct cursor positions via getBookmark roundtrip", () => {
    let state = createState(createDoc("hello world"));
    const multiSel = makeMultiSelection(state, [1, 7]);
    state = state.apply(state.tr.setSelection(multiSel));

    // Verify MultiSelection is active before the edit
    expect(state.selection).toBeInstanceOf(MultiSelection);
    expect((state.selection as MultiSelection).ranges).toHaveLength(2);

    // Type to create a history entry
    const inputTr = handleMultiCursorInput(state, "Z");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);

    // Undo
    undo(state, (tr) => { state = state.apply(tr); });

    // Document text is restored
    expect(getDocText(state)).toBe("hello world");

    // Selection must be restored as a MultiSelection (requires getBookmark implementation)
    expect(state.selection).toBeInstanceOf(MultiSelection);
    const restored = state.selection as MultiSelection;

    // Must have the same number of cursor ranges as the original
    expect(restored.ranges).toHaveLength(2);

    // Cursor positions must match the original positions (1 and 7)
    expect(restored.ranges[0].$from.pos).toBe(1);
    expect(restored.ranges[0].$to.pos).toBe(1);
    expect(restored.ranges[1].$from.pos).toBe(7);
    expect(restored.ranges[1].$to.pos).toBe(7);

    // Primary index must be preserved
    expect(restored.primaryIndex).toBe(1);
  });

  it("handles undo when multi-cursor edit merges into single range", () => {
    // Two cursors very close — after edit, they may produce adjacent content
    let state = createState(createDoc("ab"));
    const multiSel = makeMultiSelection(state, [1, 2]);
    state = state.apply(state.tr.setSelection(multiSel));

    const inputTr = handleMultiCursorInput(state, "X");
    expect(inputTr).not.toBeNull();
    state = state.apply(inputTr!);
    expect(getDocText(state)).toBe("XaXb");

    // Undo should cleanly restore original
    undo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("ab");

    // Redo should cleanly re-apply
    redo(state, (tr) => { state = state.apply(tr); });
    expect(getDocText(state)).toBe("XaXb");
  });
});
