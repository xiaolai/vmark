/**
 * Source-mode block PLACEMENT.
 *
 * Purpose: decide WHERE block-level markdown goes, as distinct from what it
 * contains. Splicing at the caret — right for inline content — produced
 * `The quick ---` (a paragraph ending in hyphens, not a thematic break) and
 * alerts that cut a sentence in half.
 *
 * Key decisions:
 *   - A block opens a line BELOW the cursor's line rather than splitting it.
 *   - It inherits the enclosing structure's continuation prefix, so a divider
 *     inside a list item or a blockquote stays inside it instead of ending it.
 *   - An underline-shaped block (`---`, `===`) gets a separator line above it,
 *     or the line before reads it as a SETEXT UNDERLINE and becomes a heading.
 *     A `standalone` block (`[TOC]`) gets one for the opposite reason: without
 *     it the line lazily CONTINUES the paragraph above. Inside a quote that
 *     separator is itself quoted, and when the block replaces an empty line the
 *     line needing protection is the text line above it.
 *   - The selection-consuming builders REPLACE the selected lines, because they
 *     fold that selection into the block they return.
 *   - A line marker belongs to the line: prepended after any indentation and
 *     inside any quote wrapper.
 *   - A BLANK line in an indented block still carries the (trimmed) prefix: a
 *     bare blank line inside a blockquote terminates the quote.
 *   - `replaceLinesWithBlock` requires an explicit range, so the caller that has
 *     widened the selection to whole blocks replaces exactly what it folded in.
 *   - A template's `cursorOffset` is measured against the UNINDENTED text, so it
 *     is mapped through the prefix transformation before it becomes an anchor.
 *
 * @coordinates-with sourceInsertActions.ts — the insert handlers
 * @coordinates-with sourceAdapterHelpers.ts — inline formatting counterpart
 * @module plugins/toolbarActions/sourceBlockPlacement
 */
import type { EditorView } from "@codemirror/view";
import { columnAfter, containerPrefixParts } from "@/plugins/shared/fenceDelimiter";

/**
 * Insert BLOCK-level markdown on its own line, below the line the cursor is on.
 *
 * `insertText` splices at the caret, which is right for inline content and
 * wrong for every block: with the cursor mid-sentence it produced
 * `The quick ---` (a paragraph ending in hyphens, not a thematic break),
 * `The quick > [!NOTE]` splitting the sentence, and tables and `<details>`
 * opening inside a paragraph. None of those mean what the user asked for.
 *
 * Inserting BELOW the current line rather than splitting it is the
 * non-destructive reading, and the one WYSIWYG already uses for alerts: the
 * sentence being typed stays intact. An empty line hosts the block directly
 * instead of leaving a stray blank above it.
 *
 * @param cursorOffset - caret position within the inserted block; defaults to
 *   its end.
 * @param opts.standalone - the block is PARAGRAPH-LEVEL markdown (`[TOC]`):
 *   with no blank line above it, it lazily continues the paragraph above and
 *   never becomes its own block. Fenced, quoted and HTML blocks interrupt a
 *   paragraph on their own and do not need this.
 */
export function insertBlockText(
  view: EditorView,
  text: string,
  cursorOffset?: number,
  opts: { standalone?: boolean } = {},
): void {
  const { from, to, insert, anchor } = planBlockInsertion(
    view.state,
    text,
    cursorOffset,
    opts.standalone === true,
  );
  view.dispatch({ changes: { from, to, insert }, selection: { anchor } });
  view.focus();
}

/** What a block insertion amounts to: one replacement and where the caret lands. */
interface BlockInsertionPlan {
  from: number;
  to: number;
  insert: string;
  anchor: number;
}

/**
 * Decide the placement (pure — no dispatch, no focus): the structure prefix,
 * the separator line, the replacement range and the caret. `insertBlockText`
 * is the thin wrapper that applies it (audit #435).
 */
function planBlockInsertion(
  state: EditorView["state"],
  text: string,
  cursorOffset: number | undefined,
  standalone: boolean,
): BlockInsertionPlan {
  const line = state.doc.lineAt(state.selection.main.from);
  const onEmptyLine = isBlankLine(line.text);

  // Carry the enclosing structure onto the new block: a divider inserted inside
  // a list item belongs to that item, and one inside a blockquote belongs to
  // the quote. Inserting at the top level instead silently ended the list or
  // quote at the cursor — WYSIWYG nests, because it inserts into the node tree.
  const prefix = continuationPrefix(line.text);
  const body = indentBlock(text, prefix);

  // A block whose first line is a run of `-` or `=` reads as a SETEXT UNDERLINE
  // for the line above it, so `text` + `---` becomes a heading rather than a
  // paragraph and a rule. A standalone block has the same need for the opposite
  // reason: `text` + `[TOC]` is ONE paragraph, because a line with no blank line
  // above it continues the paragraph, and the pipeline only recognises `[TOC]`
  // as the sole content of its own. Either way a separator line keeps the block
  // a block — and inside a quote that line must itself be quoted, or it ends the
  // quote instead of continuing it. Checked on the RAW text, since the indented
  // body no longer starts with the run. The line it protects against is the
  // cursor's own, or — on an empty line, which the block REPLACES and which was
  // the only gap — the text line above that.
  const underlineShaped = /^\s*(?:=+|-+)\s*$/.test(text.split("\n")[0] ?? "");
  const lineAbove = onEmptyLine ? textOfLineAbove(state, line.number) : line.text;
  const needsSeparator =
    (underlineShaped || standalone) && lineAbove !== null && hasContent(lineAbove);
  const separator = needsSeparator ? `${prefix.trimEnd()}\n` : "";
  const lead = `${onEmptyLine ? "" : "\n"}${separator}`;

  // Opening a new line below is enough to give the block its own line — the
  // remainder of the document already begins with the next line break, so no
  // trailing newline is added here.
  const from = onEmptyLine ? line.from : line.to;
  const insert = `${lead}${body}`;
  const blockStart = from + lead.length;
  const caret =
    typeof cursorOffset === "number" ? mapOffsetThroughPrefix(text, prefix, cursorOffset) : body.length;

  return { from, to: onEmptyLine ? line.to : from, insert, anchor: blockStart + caret };
}

/** The text of the line above line `number`, or `null` on the first line. */
const textOfLineAbove = (state: EditorView["state"], number: number): string | null =>
  number > 1 ? state.doc.line(number - 1).text : null;

/**
 * Is the line BLANK in CommonMark's sense — spaces and tabs only?
 *
 * `.trim()` also strips NBSP and every other Unicode space, none of which
 * CommonMark treats as blank: a line holding only U+3000 (a CJK keyboard's
 * default) is a paragraph, and reading it as empty made the insertion REPLACE
 * it, deleting real content silently (audit R2, #869).
 */
function isBlankLine(lineText: string): boolean {
  return /^[ \t]*$/.test(lineText);
}

/** Does the line carry text beyond its quote/list continuation prefix? */
function hasContent(lineText: string): boolean {
  const consumed = containerPrefixParts(lineText).reduce((n, p) => n + p.text.length, 0);
  return !isBlankLine(lineText.slice(consumed));
}

/**
 * Map a caret offset in the RAW block template onto the prefixed body.
 *
 * `cursorOffset` is measured against the unindented text while `indentBlock`
 * prefixes every line, so inside a list or quote the raw offset landed the caret
 * short by one prefix per line — in the markup instead of a table's first cell.
 * Each line adds what `indentBlock` gave it; a BLANK line adds the trimmed prefix.
 */
function mapOffsetThroughPrefix(text: string, prefix: string, offset: number): number {
  // Clamped BEFORE the branch: the prefixed path bounds the offset at its loop's
  // end, the unprefixed one forwarded the caller's number untouched — and these
  // offsets are COMPUTED, so one past the template's end became an anchor outside
  // the document, which CodeMirror rejects (audit R2, #870). A non-finite offset
  // lands at the body's end, as a template asking for no caret position does.
  const clamped = Number.isFinite(offset) ? Math.min(Math.max(offset, 0), text.length) : text.length;
  if (!prefix) return clamped;
  let mapped = 0;
  let remaining = clamped;
  for (const line of text.split("\n")) {
    const added = line === "" ? prefix.trimEnd() : prefix;
    if (remaining <= line.length) return mapped + added.length + remaining;
    mapped += added.length + line.length + 1;
    remaining -= line.length + 1;
  }
  // An offset past the template's end clamps to the body's end; the loop has
  // counted one newline the body does not have.
  return mapped - 1;
}

/**
 * The prefix a following line needs to stay inside the same block as `lineText`:
 * a blockquote's marker verbatim, a list item's as spaces to the same COLUMN.
 *
 * The walk is `containerPrefixParts` — the one the fence guards use — not a
 * second, WRONG copy of that grammar (audit R3 #871). The regexes it replaces
 * matched quotes then ONE list marker (`- > text` read as a bare list item, so a
 * block left the blockquote), accepted any indent and any digit count, and
 * consumed a TASK CHECKBOX as structure — indenting six columns into an item
 * whose content column is two, i.e. into indented code. COLUMNS, not characters.
 */
function continuationPrefix(lineText: string): string {
  let column = 0;
  let prefix = "";
  for (const part of containerPrefixParts(lineText)) {
    // A quote marker is STRUCTURE the next line repeats; a list marker is
    // consumed, and its width becomes the item's continuation indent.
    const next = columnAfter(part.text, column);
    prefix += part.list ? " ".repeat(next - column) : part.text;
    column = next;
  }
  return prefix;
}

/**
 * Apply a continuation prefix to every line of a block.
 *
 * A BLANK line gets the prefix too, TRIMMED of its trailing space: inside a
 * blockquote it must still carry `>` or the quote terminates — a details block
 * dropped into a quote came out as quote, loose HTML, then quote again — while
 * inside a list the prefix is only spaces, so trimming leaves it truly empty.
 */
function indentBlock(text: string, prefix: string): string {
  if (!prefix) return text;
  return text
    .split("\n")
    .map((l) => (l === "" ? prefix.trimEnd() : `${prefix}${l}`))
    .join("\n");
}

/**
 * Replace the SELECTED LINES with a block that already contains their text.
 *
 * The selection-consuming builders (alerts, details, math and diagram fences)
 * fold the selection into the block they return, so the insertion has to take
 * the selection's place — inserting below would leave the original text behind
 * and duplicate it inside the block.
 *
 * The range is REQUIRED: the caller has widened the selection to whole blocks,
 * and that widened range is what the block contains and so what it must
 * replace. A fallback that re-derived lines from the raw selection here could
 * only disagree with what was folded in.
 */
export function replaceLinesWithBlock(
  view: EditorView,
  text: string,
  cursorOffset: number | undefined,
  range: { from: number; to: number },
): void {
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + (typeof cursorOffset === "number" ? cursorOffset : text.length) },
  });
  view.focus();
}

/**
 * Put a line-level marker (`- `, `1. `, `- [ ] `) at the START of the current
 * line, after any existing indentation.
 *
 * Inserting it at the caret instead produced `The quick - brown fox`, and with a
 * range selection it replaced the selected word outright. A list marker is a
 * property of the line, not of the cursor position within it.
 *
 * The caret keeps its position in the text, shifting by the marker's width so it
 * stays on the same character the user was editing.
 *
 * @param pos - line to mark, instead of the main selection's. A multi-cursor
 *   caller supplies it and keeps its other cursors: setting a single anchor
 *   would dissolve the multi-selection mid-loop, and the default change mapping
 *   already carries every caret across the inserted marker.
 */
export function prependLineMarker(view: EditorView, marker: string, pos?: number): boolean {
  const { state } = view;
  const from = typeof pos === "number" ? pos : state.selection.main.from;
  const line = state.doc.lineAt(from);

  // Go INSIDE any blockquote wrapper: the list belongs to the quoted content,
  // so `> text` becomes `> - text`. Writing the marker before the `>` produced
  // `- > text`, a list item containing a quote — the opposite nesting.
  //
  // Spaces and tabs only, as CommonMark defines indentation. `\s` also matches
  // NBSP and the ideographic space, which are ordinary CHARACTERS here — with
  // `\s` the wrapper swallowed them and the heading run below was then matched
  // against text that does not start the line (audit R2, #872).
  const wrapper = /^[ \t]*(?:>[ \t]?)*[ \t]*/.exec(line.text)?.[0] ?? "";
  const at = line.from + wrapper.length;

  // A heading run is REPLACED, not kept: a line cannot be a heading and a list
  // item at once, and WYSIWYG drops the heading when converting. Keeping it
  // produced `- ### text`, a bullet whose content is a heading.
  //
  // The run must be followed by a SPACE, A TAB or the line end — CommonMark
  // §ATX. `\s+` also matches a NBSP, so `###` + U+00A0 + `Title` — ordinary
  // paragraph text, not a heading — lost its literal hashes when a list marker
  // was applied (audit R2, #872).
  const headingRun = /^#{1,6}(?:[ \t]+|$)/.exec(line.text.slice(wrapper.length))?.[0] ?? "";

  const changes = { from: at, to: at + headingRun.length, insert: marker };
  view.dispatch(
    typeof pos === "number"
      ? { changes }
      : { changes, selection: { anchor: Math.max(at, from - headingRun.length) + marker.length } },
  );
  view.focus();
  return true;
}
