/**
 * Multi-cursor clipboard handling
 */
import { SelectionRange } from "@tiptap/pm/state";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { MultiSelection } from "./MultiSelection";
import { normalizeRangesWithPrimary } from "./rangeUtils";

/**
 * Serialize multi-selection content for clipboard.
 */
export function getMultiCursorClipboardText(state: EditorState): string {
  const { selection } = state;
  if (!(selection instanceof MultiSelection)) return "";
  return selection.getTextContent(state.doc);
}

/**
 * Handle paste for multi-cursor selections.
 * Distributes lines if line count matches cursor count.
 */
export function handleMultiCursorPaste(
  state: EditorState,
  text: string
): Transaction | null {
  const { selection } = state;

  if (!(selection instanceof MultiSelection)) {
    return null;
  }

  const ranges = selection.ranges;
  if (ranges.length === 0) return null;

  const lines = text.split(/\r?\n/);
  const textsToInsert =
    lines.length === ranges.length ? lines : ranges.map(() => text);

  const sorted = ranges
    .map((range, index) => ({ range, text: textsToInsert[index] }))
    .sort((a, b) => b.range.$from.pos - a.range.$from.pos);

  let tr = state.tr;

  for (const entry of sorted) {
    tr = tr.insertText(entry.text, entry.range.$from.pos, entry.range.$to.pos);
  }

  const newRanges: SelectionRange[] = ranges.map((range) => {
    const newFrom = tr.mapping.map(range.$from.pos);
    const newTo = tr.mapping.map(range.$to.pos);
    const newPos = Math.max(newFrom, newTo);
    const $pos = tr.doc.resolve(newPos);
    return new SelectionRange($pos, $pos);
  });

  const normalized = normalizeRangesWithPrimary(
    newRanges,
    tr.doc,
    selection.primaryIndex
  );

  const newSel = new MultiSelection(normalized.ranges, normalized.primaryIndex);
  tr = tr.setSelection(newSel);
  tr = tr.setMeta("addToHistory", true);

  return tr;
}
