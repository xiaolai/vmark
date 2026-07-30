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
 *     or the line before would read it as a SETEXT UNDERLINE and become a
 *     heading. Inside a quote that separator is itself quoted.
 *   - The selection-consuming builders REPLACE the selected lines, because they
 *     fold that selection into the block they return; inserting below would
 *     leave the original behind and duplicate it.
 *   - A line marker belongs to the line, so it is prepended after any
 *     indentation and inside any quote wrapper.
 *
 * @coordinates-with sourceInsertActions.ts — the insert handlers
 * @coordinates-with sourceAdapterHelpers.ts — inline formatting counterpart
 * @module plugins/toolbarActions/sourceBlockPlacement
 */
import type { EditorView } from "@codemirror/view";

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
 */
export function insertBlockText(view: EditorView, text: string, cursorOffset?: number): void {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.from);
  const onEmptyLine = line.text.trim() === "";

  // Carry the enclosing structure onto the new block: a divider inserted inside
  // a list item belongs to that item, and one inside a blockquote belongs to
  // the quote. Inserting at the top level instead silently ended the list or
  // quote at the cursor — WYSIWYG nests, because it inserts into the node tree.
  const prefix = continuationPrefix(line.text);
  const body = indentBlock(text, prefix);

  // A block whose first line is a run of `-` or `=` reads as a SETEXT UNDERLINE
  // for the line above it, so `text` + `---` becomes a heading rather than a
  // paragraph and a rule. A separator line between them is what keeps the
  // divider a divider — and inside a quote that line must itself be quoted, or
  // it ends the quote instead of continuing it. Checked on the RAW text, since
  // the indented body no longer starts with the run.
  const underlineShaped = /^\s*(?:=+|-+)\s*$/.test(text.split("\n")[0] ?? "");
  const separator = underlineShaped && !onEmptyLine ? `\n${prefix.trimEnd()}` : "";
  const lead = onEmptyLine ? "" : `\n${separator ? `${separator.slice(1)}\n` : ""}`;

  // Opening a new line below is enough to give the block its own line — the
  // remainder of the document already begins with the next line break, so no
  // trailing newline is added here.
  const from = onEmptyLine ? line.from : line.to;
  const insert = onEmptyLine ? body : `${lead}${body}`;
  const blockStart = from + lead.length;

  view.dispatch({
    changes: { from, to: onEmptyLine ? line.to : from, insert },
    selection: { anchor: blockStart + (typeof cursorOffset === "number" ? cursorOffset : body.length) },
  });
  view.focus();
}

/**
 * The prefix a following line needs to stay inside the same block as `lineText`.
 *
 * A blockquote's marker repeats verbatim (`> `); a list item's marker becomes
 * whitespace of the same width, which is what keeps content inside the item
 * rather than starting a sibling.
 */
function continuationPrefix(lineText: string): string {
  const quote = /^\s*(?:>\s?)+/.exec(lineText)?.[0] ?? "";
  const rest = lineText.slice(quote.length);
  const listMarker = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.exec(rest)?.[0] ?? "";
  return `${quote}${" ".repeat(listMarker.length)}`;
}

/**
 * Apply a continuation prefix to every line of a block.
 *
 * A BLANK line gets the prefix too, trimmed of its trailing space. That trim is
 * the whole point: inside a blockquote the blank line must still carry `>` or it
 * terminates the quote — a details block dropped into a quote came out as quote,
 * then loose HTML, then quote again. Inside a list the prefix is only spaces, so
 * trimming leaves the line properly empty rather than whitespace-padded.
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
 * and duplicate it inside the block. Expanding to whole lines keeps the block
 * from starting mid-sentence.
 */
export function replaceLinesWithBlock(
  view: EditorView,
  text: string,
  cursorOffset?: number,
  range?: { from: number; to: number },
): void {
  const { state } = view;
  const { from, to } = state.selection.main;
  // The caller may have widened the selection to whole blocks; when it has, that
  // widened range is what the block contains and so what it must replace.
  const start = range?.from ?? state.doc.lineAt(from).from;
  const stop = range?.to ?? state.doc.lineAt(to).to;

  view.dispatch({
    changes: { from: start, to: stop, insert: text },
    selection: { anchor: start + (typeof cursorOffset === "number" ? cursorOffset : text.length) },
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
 */
export function prependLineMarker(view: EditorView, marker: string): boolean {
  const { state } = view;
  const { from } = state.selection.main;
  const line = state.doc.lineAt(from);

  // Go INSIDE any blockquote wrapper: the list belongs to the quoted content,
  // so `> text` becomes `> - text`. Writing the marker before the `>` produced
  // `- > text`, a list item containing a quote — the opposite nesting.
  const wrapper = /^\s*(?:>\s?)*\s*/.exec(line.text)?.[0] ?? "";
  const at = line.from + wrapper.length;

  // A heading run is REPLACED, not kept: a line cannot be a heading and a list
  // item at once, and WYSIWYG drops the heading when converting. Keeping it
  // produced `- ### text`, a bullet whose content is a heading.
  const headingRun = /^#{1,6}(?:\s+|$)/.exec(line.text.slice(wrapper.length))?.[0] ?? "";

  view.dispatch({
    changes: { from: at, to: at + headingRun.length, insert: marker },
    selection: { anchor: Math.max(at, from - headingRun.length) + marker.length },
  });
  view.focus();
  return true;
}
