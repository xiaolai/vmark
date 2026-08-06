/**
 * Container-aware list block bounds for Source mode.
 *
 * Purpose: find the span of the ONE list containing the cursor, for smart
 * select-all and whole-list conversion. "One list" follows CommonMark:
 *   - A continuation line (non-blank, indented to at least the outermost open
 *     item's content column) belongs to the item above it, so a paragraph or
 *     child block inside an item no longer splits the list into partial
 *     ranges. Lazy continuation (flush-left prose after an item) is
 *     deliberately excluded — editing commands should not swallow it.
 *   - Changing the bullet char or ordered delimiter at the top level STARTS A
 *     NEW LIST ("- one" / "* two" / "1. three" is three lists). Nested
 *     children may use any marker without splitting the parent.
 *   - Blank lines between items make a list loose; they do not end it.
 *
 * The scan is bidirectional: a permissive upward pass finds where scanning
 * must begin, and a rigorous downward pass from there builds the chunks and
 * discards any upward overshoot.
 *
 * @coordinates-with listBlockConversion.ts — converts exactly this span
 * @coordinates-with codemirror/sourceShortcuts.ts — Mod-A smart select-all
 * @module plugins/sourceContextDetection/listBlockBounds
 */
import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { parseListMarker } from "./listMarkerParsing";

interface ChunkMarker {
  lineNum: number;
  indent: number;
  delimiter: string;
}

/** A maximal contiguous run of marker lines, bridging blanks, and continuations. */
interface Chunk {
  start: number;
  end: number;
  markers: ChunkMarker[];
}

function leadingWidth(text: string): number {
  /* v8 ignore next -- @preserve reason: a star-quantified leading match always succeeds */
  return /^[ \t]*/.exec(text)?.[0].length ?? 0;
}

/**
 * Upward heuristic: the highest line that could still belong to the cursor's
 * list. Marker lines, blanks, and indented lines are all accepted — the
 * downward validation pass discards overshoot. A flush-left non-marker line
 * can never be part of the list, so it is a hard stop.
 */
function findScanStart(doc: Text, fromLine: number): number {
  let start = fromLine;
  for (let n = fromLine - 1; n >= 1; n -= 1) {
    const text = doc.line(n).text;
    if (text.trim() !== "" && leadingWidth(text) === 0 && !parseListMarker(text)) break;
    start = n;
  }
  return start;
}

/**
 * Scan one chunk downward from a known marker line. `openCols` tracks the
 * content columns of the currently open items, outermost first; a line
 * indented to at least the OUTERMOST content column is inside the list.
 */
function scanChunk(doc: Text, startLine: number, opening: { contentCol: number; indent: string; delimiter: string }): Chunk {
  const markers: ChunkMarker[] = [
    { lineNum: startLine, indent: opening.indent.length, delimiter: opening.delimiter },
  ];
  const openCols: number[] = [opening.contentCol];
  let end = startLine;

  for (let n = startLine + 1; n <= doc.lines; n += 1) {
    const text = doc.line(n).text;
    // A blank decides nothing by itself: the next non-blank line either pulls
    // it into the chunk (loose list) or leaves it outside (list boundary).
    if (text.trim() === "") continue;

    const parsed = parseListMarker(text);
    if (parsed) {
      const indent = parsed.indent.length;
      // A new item at this indent closes any deeper open items.
      while (openCols.length > 0 && openCols[openCols.length - 1] > indent) openCols.pop();
      openCols.push(parsed.contentCol);
      markers.push({ lineNum: n, indent, delimiter: parsed.delimiter });
      end = n;
      continue;
    }

    if (leadingWidth(text) >= openCols[0]) {
      end = n; // continuation of an open item
      continue;
    }
    break;
  }

  return { start: startLine, end, markers };
}

/**
 * The chunk containing `targetLine`, which the caller guarantees is a marker
 * line — that guarantee is what terminates both loops.
 */
function chunkContaining(doc: Text, scanStart: number, targetLine: number): Chunk {
  let n = scanStart;
  for (;;) {
    // Leading blanks or stray indented lines accepted by the upward
    // heuristic cannot OPEN a list; skip to the next marker line.
    let opening = parseListMarker(doc.line(n).text);
    while (!opening) {
      n += 1;
      opening = parseListMarker(doc.line(n).text);
    }
    const chunk = scanChunk(doc, n, opening);
    if (chunk.end >= targetLine) return chunk;
    n = chunk.end + 1;
  }
}

/**
 * Split the chunk at top-level delimiter changes and return the span of the
 * group holding `targetLine`. An item one column deeper than the shallowest
 * cannot be anyone's child (a child needs at least the parent's two-column
 * marker), so it still counts as top level for delimiter comparison.
 */
function groupSpan(chunk: Chunk, targetLine: number): { first: number; last: number } {
  let minIndent = Infinity;
  for (const marker of chunk.markers) minIndent = Math.min(minIndent, marker.indent);
  const tops = chunk.markers.filter((marker) => marker.indent <= minIndent + 1);

  const starts: number[] = [chunk.start];
  for (let i = 1; i < tops.length; i += 1) {
    if (tops[i].delimiter !== tops[i - 1].delimiter) starts.push(tops[i].lineNum);
  }

  let first = chunk.start;
  let last = chunk.end;
  for (let i = 0; i < starts.length; i += 1) {
    const groupFirst = starts[i];
    const groupLast = i + 1 < starts.length ? starts[i + 1] - 1 : chunk.end;
    if (targetLine >= groupFirst && targetLine <= groupLast) {
      first = groupFirst;
      last = groupLast;
      break;
    }
  }
  return { first, last };
}

/**
 * Get the bounds of the list containing the cursor.
 *
 * Returns { from, to } character offsets or null if the cursor is not on a
 * list-item line.
 */
export function getListBlockBounds(view: EditorView): { from: number; to: number } | null {
  const { state } = view;
  const doc = state.doc;
  const currentLine = doc.lineAt(state.selection.main.from);
  if (!parseListMarker(currentLine.text)) return null;

  const chunk = chunkContaining(doc, findScanStart(doc, currentLine.number), currentLine.number);
  const span = groupSpan(chunk, currentLine.number);

  // A group ending at a list boundary may still hold the blank line that
  // separated it from the next list.
  let last = span.last;
  while (last > span.first && doc.line(last).text.trim() === "") last -= 1;

  return { from: doc.line(span.first).from, to: doc.line(last).to };
}
