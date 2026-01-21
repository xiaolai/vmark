import { EditorSelection, type SelectionRange } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

interface BlockRange {
  from: number;
  to: number;
}

function getBlockRange(view: EditorView, pos: number): BlockRange {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  let startLine = line.number;
  let endLine = line.number;

  while (startLine > 1 && doc.line(startLine - 1).text.trim() !== "") {
    startLine -= 1;
  }

  while (endLine < doc.lines && doc.line(endLine + 1).text.trim() !== "") {
    endLine += 1;
  }

  return {
    from: doc.line(startLine).from,
    to: doc.line(endLine).to,
  };
}

function getWordAtPos(view: EditorView, pos: number): { from: number; to: number } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const text = line.text;
  const offset = pos - line.from;

  const wordRegex = /[\p{L}\p{N}_]+/gu;
  let match: RegExpExecArray | null;
  while ((match = wordRegex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (offset >= start && offset <= end) {
      return { from: line.from + start, to: line.from + end };
    }
  }

  return null;
}

function selectionText(view: EditorView): { text: string; range: { from: number; to: number } } | null {
  const main = view.state.selection.main;
  if (main.from !== main.to) {
    return { text: view.state.doc.sliceString(main.from, main.to), range: main };
  }

  const word = getWordAtPos(view, main.from);
  if (!word) return null;

  return { text: view.state.doc.sliceString(word.from, word.to), range: word };
}

function hasRange(selection: EditorSelection, from: number, to: number): boolean {
  return selection.ranges.some((range) => range.from === from && range.to === to);
}

export function selectNextOccurrenceInBlock(view: EditorView): boolean {
  const selection = view.state.selection;
  const main = selection.main;
  const query = selectionText(view);
  if (!query || query.text.length === 0) return false;

  if (main.from === main.to) {
    view.dispatch({
      selection: EditorSelection.single(query.range.from, query.range.to),
    });
    return true;
  }

  const block = getBlockRange(view, main.from);
  const docText = view.state.doc.sliceString(block.from, block.to);
  const blockRanges = selection.ranges.filter(
    (r) => r.from >= block.from && r.to <= block.to
  );
  const selectionEnd = Math.max(
    main.to,
    ...blockRanges.map((r) => r.to)
  );
  const startOffset = Math.max(selectionEnd, block.from) - block.from;

  let index = docText.indexOf(query.text, startOffset);
  if (index === -1 && startOffset > 0) {
    index = docText.indexOf(query.text, 0);
  }

  while (index !== -1) {
    const from = block.from + index;
    const to = from + query.text.length;
    if (!hasRange(selection, from, to)) {
      const ranges = [...selection.ranges, EditorSelection.range(from, to)];
      view.dispatch({
        selection: EditorSelection.create(ranges, ranges.length - 1),
      });
      return true;
    }
    index = docText.indexOf(query.text, index + query.text.length);
  }

  return false;
}

export function selectAllOccurrencesInBlock(view: EditorView): boolean {
  const selection = view.state.selection;
  const main = selection.main;
  const query = selectionText(view);
  if (!query || query.text.length === 0) return false;

  const block = getBlockRange(view, main.from);
  const docText = view.state.doc.sliceString(block.from, block.to);
  const ranges: SelectionRange[] = [];

  let index = 0;
  while ((index = docText.indexOf(query.text, index)) !== -1) {
    const from = block.from + index;
    const to = from + query.text.length;
    ranges.push(EditorSelection.range(from, to));
    index += query.text.length;
  }

  if (ranges.length === 0) return false;

  const mainIndex = ranges.findIndex(
    (r) => r.from <= query.range.from && r.to >= query.range.to
  );

  view.dispatch({
    selection: EditorSelection.create(ranges, Math.max(mainIndex, 0)),
  });

  return true;
}
