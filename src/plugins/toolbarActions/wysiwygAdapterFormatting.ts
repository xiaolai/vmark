/**
 * WYSIWYG Adapter - Formatting Actions
 *
 * Purpose: Text formatting, blockquote toggling, case transforms and clear
 * formatting for WYSIWYG mode. These are inline/block-level formatting
 * operations triggered by toolbar buttons.
 *
 * Heading-level stepping lives in `wysiwygHeadingLevel.ts`.
 *
 * Key decisions:
 *   - Blockquote wraps the OUTERMOST enclosing list, not the sub-list the cursor
 *     is in: quoting one nested item left its siblings outside and split the
 *     structure into list / quoted list / list.
 *   - Case transforms replace each selected TEXT-NODE slice individually:
 *     replacing the whole selection with one concatenated text node destroyed
 *     block boundaries, collapsed mixed marks and discarded inline atoms.
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates formatting actions here
 * @coordinates-with enableRules.ts — decides which formatting actions are enabled
 * @coordinates-with wysiwygHeadingLevel.ts — the heading pair split out of here
 * @coordinates-with wysiwygTextPositionMap.ts — text-offset/doc-position mapping
 * @module plugins/toolbarActions/wysiwygAdapterFormatting
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, Mark as PMMark } from "@tiptap/pm/model";
import { handleRemoveBlockquote } from "@/plugins/formatToolbar/nodeActions.tiptap";
import { MultiSelection } from "@/plugins/multiCursor";
import { toUpperCase, toLowerCase, toTitleCase, toggleCase } from "@/utils/textTransformations";
import { computeQuoteToggle } from "@/lib/cjkFormatter/quoteToggle";
import { useSettingsStore } from "@/stores/settingsStore";
import { buildTextPositionMap, parentOffsetToTextOffset } from "./wysiwygTextPositionMap";
import type { WysiwygToolbarContext } from "./types";

/**
 * Clear all inline marks from the selection (or multi-selection ranges).
 */
export function clearFormattingInView(view: EditorView): boolean {
  const { state, dispatch } = view;
  const { selection } = state;
  const ranges = selection instanceof MultiSelection
    ? selection.ranges
    : [{ $from: selection.$from, $to: selection.$to }];
  let tr = state.tr;
  let applied = false;

  for (const range of ranges) {
    const from = range.$from.pos;
    const to = range.$to.pos;
    if (from === to) continue;
    applied = true;
    state.doc.nodesBetween(from, to, (node: PMNode, pos: number) => {
      if (node.isText && node.marks.length > 0) {
        node.marks.forEach((mark: PMMark) => {
          tr = tr.removeMark(
            Math.max(from, pos),
            Math.min(to, pos + node.nodeSize),
            mark.type
          );
        });
      }
    });
  }

  if (applied && tr.docChanged) {
    dispatch(tr);
    view.focus();
    return true;
  }
  return false;
}

/**
 * Toggle blockquote on the current block. Handles wrapping lists inside blockquotes.
 */
export function toggleBlockquote(editor: TiptapEditor): boolean {
  if (editor.isActive("blockquote")) {
    // Use handleRemoveBlockquote to properly unwrap the entire blockquote,
    // not just the current selection's block range — and report ITS outcome,
    // not an unconditional success.
    return handleRemoveBlockquote(editor.view);
  }

  const { state, dispatch } = editor.view;
  const { $from, $to } = state.selection;
  const blockquoteType = state.schema.nodes.blockquote;
  if (!blockquoteType) return false;

  // Inside a list, wrap the OUTERMOST list — the whole structure, not the
  // sub-list the cursor happens to sit in. Breaking at the innermost one quoted
  // a single nested item and left its siblings outside, so `- outer` /
  // `  - inner` / `- last` came apart into a list, a quoted list, and a list.
  // The loop descends, so dropping the `break` leaves the shallowest match.
  let wrapDepth = -1;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bulletList" || node.type.name === "orderedList") {
      wrapDepth = d;
    }
  }

  let range;
  if (wrapDepth > 0) {
    const listStart = $from.before(wrapDepth);
    const listEnd = $from.after(wrapDepth);
    range = state.doc.resolve(listStart).blockRange(state.doc.resolve(listEnd));
  } else {
    range = $from.blockRange($to);
  }

  if (range) {
    try {
      dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
      editor.view.focus();
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/** The selected slice of one text node, in doc coordinates. */
interface SelectedSlice {
  from: number;
  to: number;
  text: string;
}

/** Word-character class mirroring toTitleCase's boundary detection. */
const TITLE_WORD_CHAR = /[\p{L}\p{N}'’]/u;

/**
 * Transform each slice's case, deciding anything that needs more than one
 * slice's context over the WHOLE selection:
 *   - toggleCase picks its direction by case majority across all slices, as
 *     it did when the selection was transformed as one string;
 *   - titleCase must not capitalize a slice that continues the previous
 *     slice's word (adjacent text nodes split only by a mark boundary). A
 *     digit prepended as sentinel reproduces that left context — it is
 *     word-internal to the boundary class, caseless, and length-stable, so it
 *     only suppresses the leading word start and is sliced back off.
 */
function transformSliceCase(
  slices: SelectedSlice[],
  caseType: "uppercase" | "lowercase" | "titleCase" | "toggleCase"
): string[] {
  switch (caseType) {
    case "uppercase":
      return slices.map((s) => toUpperCase(s.text));
    case "lowercase":
      return slices.map((s) => toLowerCase(s.text));
    case "toggleCase": {
      const whole = slices.map((s) => s.text).join("");
      const toLower = toggleCase(whole) === toLowerCase(whole);
      return slices.map((s) => (toLower ? toLowerCase(s.text) : toUpperCase(s.text)));
    }
    case "titleCase":
      return slices.map((s, i) => {
        const prev = i > 0 && slices[i - 1].to === s.from ? slices[i - 1].text : null;
        const continuesWord = prev !== null && TITLE_WORD_CHAR.test(prev.charAt(prev.length - 1));
        return continuesWord ? toTitleCase(`0${s.text}`).slice(1) : toTitleCase(s.text);
      });
  }
}

/**
 * Transform case of selected text in WYSIWYG mode.
 *
 * Each selected TEXT-NODE slice is replaced individually, in reverse document
 * order: replacing the whole selection with one concatenated text node
 * destroyed block boundaries, collapsed mixed marks and silently discarded
 * inline atoms (hard breaks, images).
 */
export function handleWysiwygTransformCase(
  context: WysiwygToolbarContext,
  caseType: "uppercase" | "lowercase" | "titleCase" | "toggleCase"
): boolean {
  const { view, editor } = context;
  if (!view || !editor) return false;

  const { state, dispatch } = view;
  const { from, to, empty } = state.selection;

  if (empty) return false; // No selection

  const slices: SelectedSlice[] = [];
  state.doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText && node.text) {
      const start = Math.max(0, from - pos);
      const end = Math.min(node.text.length, to - pos);
      if (start < end) {
        slices.push({ from: pos + start, to: pos + end, text: node.text.slice(start, end) });
      }
    }
    return true;
  });

  if (slices.length === 0) return false;

  const transformed = transformSliceCase(slices, caseType);

  // Reverse document order keeps earlier slice positions valid even when a
  // transform changes a slice's length (ß → SS).
  let tr = state.tr;
  let changed = false;
  for (let i = slices.length - 1; i >= 0; i--) {
    if (transformed[i] === slices[i].text) continue;
    tr = tr.insertText(transformed[i], slices[i].from, slices[i].to);
    changed = true;
  }

  if (!changed) return true; // Already in the requested case

  dispatch(tr);

  // Re-select the transformed range, accounting for any length change.
  const delta = transformed.reduce((sum, t, i) => sum + t.length - slices[i].text.length, 0);
  editor.commands.setTextSelection({ from, to: to + delta });
  editor.commands.focus();
  return true;
}

/**
 * Toggle the quote style of the innermost quote pair enclosing the cursor.
 *
 * Resolves cursor position to the parent text block, runs computeQuoteToggle
 * on the block text, then applies replacements via ProseMirror transaction.
 *
 * @edge-case Inline atoms (hardBreak, etc.) cause parentOffset and textContent
 *   to use different coordinate spaces — we map between them explicitly
 * @edge-case Applies replacements in reverse offset order to preserve positions
 */
export function toggleQuoteStyleAtCursor(editor: TiptapEditor): boolean {
  const { state } = editor;
  const { $from } = state.selection;
  const parent = $from.parent;

  if (!parent.isTextblock) return false;

  const { text: blockText, positions } = buildTextPositionMap(parent, $from.start());
  if (!blockText) return false;

  const cursorTextOffset = parentOffsetToTextOffset(parent, $from.parentOffset);

  const cjkSettings = useSettingsStore.getState().cjkFormatting;
  const result = computeQuoteToggle(
    blockText,
    cursorTextOffset,
    cjkSettings.quoteToggleMode,
    cjkSettings.quoteStyle
  );
  if (!result) return false;

  // Build transaction — apply replacements in reverse order to preserve positions
  let tr = state.tr;
  const sorted = [...result.replacements].sort((a, b) => b.offset - a.offset);
  for (const rep of sorted) {
    const docPos = positions[rep.offset];
    tr = tr.insertText(rep.newChar, docPos, docPos + rep.oldChar.length);
  }

  if (!tr.docChanged) return false;

  editor.view.dispatch(tr);
  editor.view.focus();
  return true;
}
