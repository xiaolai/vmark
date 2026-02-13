import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { findAnyMarkRangeAtCursor, findMarkRange, findWordAtCursor } from "@/plugins/syntaxReveal/marks";
import { MultiSelection } from "@/plugins/multiCursor";

interface LastRemovedMark {
  markType: string;
  from: number;
  to: number;
  docTextHash: number;
}

const lastRemovedMarkMap = new WeakMap<EditorView, LastRemovedMark | null>();

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash;
}

export function expandedToggleMark(view: EditorView, markTypeName: string): boolean {
  const { state, dispatch } = view;
  const markType = state.schema.marks[markTypeName];
  if (!markType) return false;

  const opposingMarkTypeName =
    markTypeName === "subscript"
      ? "superscript"
      : markTypeName === "superscript"
        ? "subscript"
        : null;
  const opposingMarkType = opposingMarkTypeName
    ? state.schema.marks[opposingMarkTypeName]
    : null;

  const { from, to, empty } = state.selection;
  const $from = state.selection.$from;
  const docTextHash = hashString(state.doc.textContent);

  const lastRemovedMark = lastRemovedMarkMap.get(view) ?? null;

  const clearLastRemoved = () => {
    lastRemovedMarkMap.set(view, null);
  };

  const setLastRemoved = (mark: LastRemovedMark) => {
    lastRemovedMarkMap.set(view, mark);
  };

  if (state.selection instanceof MultiSelection) {
    clearLastRemoved();
    const ranges = state.selection.ranges;
    const primaryRange = ranges[state.selection.primaryIndex];

    // Determine toggle direction from primary cursor (VS Code convention):
    // if primary already has the mark → remove from all; otherwise → add to all.
    const primaryFrom = primaryRange.$from.pos;
    const primaryTo = primaryRange.$to.pos;
    let shouldAdd: boolean;
    if (primaryFrom === primaryTo) {
      const wordRange = findWordAtCursor(
        primaryRange.$from as unknown as Parameters<typeof findWordAtCursor>[0]
      );
      shouldAdd = wordRange
        ? !state.doc.rangeHasMark(wordRange.from, wordRange.to, markType)
        : true;
    } else {
      shouldAdd = !state.doc.rangeHasMark(primaryFrom, primaryTo, markType);
    }

    let tr = state.tr;
    let applied = false;
    for (const range of ranges) {
      const rangeFrom = range.$from.pos;
      const rangeTo = range.$to.pos;
      if (rangeFrom === rangeTo) {
        const wordRange = findWordAtCursor(
          range.$from as unknown as Parameters<typeof findWordAtCursor>[0]
        );
        if (!wordRange) continue;
        applied = true;
        if (opposingMarkType) {
          tr = tr.removeMark(wordRange.from, wordRange.to, opposingMarkType);
        }
        if (shouldAdd) {
          tr = tr.addMark(wordRange.from, wordRange.to, markType.create());
        } else {
          tr = tr.removeMark(wordRange.from, wordRange.to, markType);
        }
      } else {
        applied = true;
        if (opposingMarkType) {
          tr = tr.removeMark(rangeFrom, rangeTo, opposingMarkType);
        }
        if (shouldAdd) {
          tr = tr.addMark(rangeFrom, rangeTo, markType.create());
        } else {
          tr = tr.removeMark(rangeFrom, rangeTo, markType);
        }
      }
    }
    if (applied) {
      dispatch(tr);
      return true;
    }
  }

  if (!empty) {
    clearLastRemoved();
    let tr = state.tr;
    if (opposingMarkType) {
      tr = tr.removeMark(from, to, opposingMarkType);
    }
    if (tr.doc.rangeHasMark(from, to, markType)) {
      tr = tr.removeMark(from, to, markType);
    } else {
      tr = tr.addMark(from, to, markType.create());
    }
    dispatch(tr);
    return true;
  }

  const markRange = findMarkRange(
    from,
    markType.create(),
    $from.start(),
    $from.parent as unknown as Parameters<typeof findMarkRange>[3]
  );

  if (markRange) {
    setLastRemoved({
      markType: markTypeName,
      from: markRange.from,
      to: markRange.to,
      docTextHash,
    });
    dispatch(state.tr.removeMark(markRange.from, markRange.to, markType));
    return true;
  }

  if (opposingMarkType) {
    const opposingRange = findMarkRange(
      from,
      opposingMarkType.create(),
      $from.start(),
      $from.parent as unknown as Parameters<typeof findMarkRange>[3]
    );
    if (opposingRange) {
      dispatch(state.tr.removeMark(opposingRange.from, opposingRange.to, opposingMarkType));
    }
  }

  if (
    lastRemovedMark &&
    lastRemovedMark.markType === markTypeName &&
    lastRemovedMark.docTextHash === docTextHash &&
    from >= lastRemovedMark.from &&
    from <= lastRemovedMark.to
  ) {
    dispatch(state.tr.addMark(lastRemovedMark.from, lastRemovedMark.to, markType.create()));
    clearLastRemoved();
    return true;
  }

  const inheritedRange = findAnyMarkRangeAtCursor(
    from,
    $from as unknown as Parameters<typeof findAnyMarkRangeAtCursor>[1]
  );

  if (inheritedRange && !(markTypeName === "code" && inheritedRange.isLink)) {
    clearLastRemoved();
    let tr = state.tr;
    if (opposingMarkType) {
      tr = tr.removeMark(inheritedRange.from, inheritedRange.to, opposingMarkType);
    }
    tr = tr.addMark(inheritedRange.from, inheritedRange.to, markType.create());
    dispatch(tr);
    return true;
  }

  // Auto-format word at cursor (uses Intl.Segmenter for CJK support)
  const wordRange = findWordAtCursor($from);
  if (wordRange) {
    clearLastRemoved();
    const originalPos = from;
    let tr = state.tr;
    if (opposingMarkType) {
      tr = tr.removeMark(wordRange.from, wordRange.to, opposingMarkType);
    }
    // Toggle: remove mark if word already has it, otherwise add
    if (tr.doc.rangeHasMark(wordRange.from, wordRange.to, markType)) {
      tr = tr.removeMark(wordRange.from, wordRange.to, markType);
    } else {
      tr = tr.addMark(wordRange.from, wordRange.to, markType.create());
    }
    // Restore cursor to original position
    tr = tr.setSelection(TextSelection.create(tr.doc, originalPos));
    dispatch(tr);
    return true;
  }

  // Fallback: toggle stored marks (for whitespace/punctuation)
  clearLastRemoved();
  const storedMarks = state.storedMarks || $from.marks();
  if (opposingMarkType && opposingMarkType.isInSet(storedMarks)) {
    dispatch(state.tr.removeStoredMark(opposingMarkType));
  }
  if (markType.isInSet(storedMarks)) {
    dispatch(state.tr.removeStoredMark(markType));
  } else {
    dispatch(state.tr.addStoredMark(markType.create()));
  }
  return true;
}
