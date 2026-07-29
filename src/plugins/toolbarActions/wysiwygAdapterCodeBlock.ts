/**
 * WYSIWYG Adapter - Code Block Conversion
 *
 * Purpose: Handles the insertCodeBlock toolbar action with "one code block"
 * semantics. A selection inside a list converts the WHOLE list (one line per
 * item, nested items indented — the same whole-list convention
 * toggleBlockquote uses); a selection spanning multiple blocks merges every
 * covered block into one code block, one line per textblock/list item. Only
 * a plain cursor outside any list falls back to Tiptap's setCodeBlock.
 *
 * Why not plain setCodeBlock everywhere: its clearNodes fallback converts
 * each covered textblock into its OWN code block — a selected 3-item list or
 * three selected paragraphs became three single-line code fences, which is
 * never what "turn this into code" means.
 *
 * Outcomes are tri-state: "converted" (doc changed), "refused" (applicable
 * but unsafe — e.g. a partially selected table — the fallback must NOT run,
 * it would shatter or consume unselected content), "notApplicable" (let the
 * fallback handle it).
 *
 * @coordinates-with wysiwygAdapter.ts — main dispatcher delegates insertCodeBlock here
 * @coordinates-with codeBlockSerialize.ts — node → text-line projection
 * @coordinates-with wysiwygAdapterFormatting.ts — toggleBlockquote shares the whole-list convention
 * @module plugins/toolbarActions/wysiwygAdapterCodeBlock
 */
import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";
import { canSplit } from "@tiptap/pm/transform";
import { wysiwygAdapterError } from "@/utils/debug";
import { collectListLines, collectBlockLines } from "./codeBlockSerialize";
import type { WysiwygToolbarContext } from "./types";

type CodeBlockOutcome = "converted" | "refused" | "notApplicable";

/**
 * Replace [from, to] in `tr` with one code block containing `text`, place the
 * cursor at its end, and dispatch. The ONE replacement path both conversions
 * share. Returns "refused" when the replace fails — a failed applicable
 * conversion must never fall through to the shattering setCodeBlock fallback.
 */
function applyCodeBlockReplacement(
  view: EditorView,
  tr: Transaction,
  from: number,
  to: number,
  text: string
): CodeBlockOutcome {
  const codeBlockType = view.state.schema.nodes.codeBlock;
  /* v8 ignore next -- @preserve defensive: VMark's schema always has codeBlock */
  if (!codeBlockType) return "notApplicable";
  try {
    const codeBlock = codeBlockType.create(null, text ? view.state.schema.text(text) : null);
    tr.replaceWith(from, to, codeBlock);
    tr.setSelection(TextSelection.create(tr.doc, from + 1 + codeBlock.content.size));
    view.dispatch(tr);
  } catch (error) {
    /* v8 ignore start -- @preserve defensive: replace only fails on schema mismatch */
    wysiwygAdapterError("code block conversion failed:", error);
    return "refused";
    /* v8 ignore stop */
  }
  view.focus();
  return "converted";
}

/**
 * Convert the outermost list containing the selection into ONE code block.
 * "notApplicable" when the selection is not inside a list or extends beyond it.
 */
function convertListToCodeBlock(view: EditorView): CodeBlockOutcome {
  const { state } = view;
  const { $from, $to } = state.selection;

  // Outermost list ancestor of $from (walk from the top down).
  let listDepth = -1;
  for (let d = 1; d <= $from.depth; d++) {
    const name = $from.node(d).type.name;
    if (name === "bulletList" || name === "orderedList") {
      listDepth = d;
      break;
    }
  }
  if (listDepth === -1) return "notApplicable";

  const listStart = $from.before(listDepth);
  const listNode = $from.node(listDepth);
  const listEnd = listStart + listNode.nodeSize;
  if ($to.pos > listEnd) return "notApplicable"; // selection spans past the list

  const lines: string[] = [];
  collectListLines(listNode, 0, lines);
  return applyCodeBlockReplacement(view, state.tr, listStart, listEnd, lines.join("\n"));
}

/**
 * Wrappers that may be SPLIT at a selection boundary so only the covered
 * part converts (their content spec is `block+`, so both halves stay valid).
 * Details (summary-first content) and tables cannot be split validly — a
 * partial selection of those refuses the conversion instead (WI-2).
 */
const SPLITTABLE_WRAPPERS = new Set(["blockquote", "alertBlock"]);

/** A block child that groups other blocks (not a textblock, list, or leaf). */
function isWrapper(node: PMNode): boolean {
  const name = node.type.name;
  return !node.isTextblock && !node.isLeaf && name !== "bulletList" && name !== "orderedList";
}

/**
 * Split partially covered splittable wrappers at each selection endpoint so
 * only the covered part converts. Returns "refused" for endpoints inside an
 * unsplittable or nested wrapper (consuming unselected content is never
 * acceptable); "converted" here means "splits applied / nothing to split".
 */
function splitPartialWrappers(
  tr: Transaction,
  range: { depth: number },
  $from: ResolvedPos,
  $to: ResolvedPos
): CodeBlockOutcome {
  for (const side of ["end", "start"] as const) {
    const $pos = side === "end" ? $to : $from;
    // Endpoint deeper than the covered-child level means it is INSIDE a child.
    if ($pos.depth <= range.depth + 1) continue;
    const child = $pos.node(range.depth + 1);
    if (!isWrapper(child)) continue; // lists keep whole-list semantics

    // Unsplittable wrappers (tables, details): direct-child granularity
    // cannot express partial coverage (a one-row table reads as "covered"
    // while a cell is unselected), so ANY endpoint inside one refuses.
    if (!SPLITTABLE_WRAPPERS.has(child.type.name)) return "refused";

    // The single-level split below only expresses "endpoint directly inside
    // the wrapper". An intermediate wrapper deeper down (a table or nested
    // quote inside this quote) would be consumed partially selected by that
    // split — refuse those. A nested LIST keeps whole-list semantics, so the
    // scan stops there.
    for (let d = range.depth + 2; d < $pos.depth; d++) {
      const ancestor = $pos.node(d);
      const name = ancestor.type.name;
      if (name === "bulletList" || name === "orderedList") break;
      if (isWrapper(ancestor)) return "refused";
    }

    // Boundary between the wrapper's direct children at this endpoint.
    const boundary = side === "end" ? $pos.after(range.depth + 2) : $pos.before(range.depth + 2);
    const contentStart = $pos.start(range.depth + 1);
    const contentEnd = $pos.end(range.depth + 1);
    const fullyCovered = side === "end" ? boundary >= contentEnd : boundary <= contentStart;
    if (fullyCovered) continue;

    // Refusal beats an exception through the toolbar dispatch path.
    const splitPos = tr.mapping.map(boundary);
    if (!canSplit(tr.doc, splitPos, 1)) return "refused";
    tr.split(splitPos, 1);
  }
  return "converted";
}

/**
 * Merge every block covered by a multi-block selection into ONE code block.
 * "notApplicable" for cursors and single-block selections (those take the
 * list or setCodeBlock path); "refused" for partially selected unsplittable
 * wrappers (details, tables).
 */
function convertSelectionToCodeBlock(view: EditorView): CodeBlockOutcome {
  const { state } = view;
  const { $from, $to, empty } = state.selection;
  if (empty) return "notApplicable";

  // Deepest ancestor whose children cover both ends (doc, blockquote, …).
  const range = $from.blockRange($to);
  /* v8 ignore next -- @preserve defensive: blockRange only fails on degenerate selections */
  if (!range) return "notApplicable";
  if (range.endIndex - range.startIndex < 2) return "notApplicable"; // single block

  // blockRange expands to WHOLE children of the shared parent, so a wrapper
  // (blockquote, alert, details, table) that a selection endpoint sits inside
  // would be wholly consumed, unselected siblings included. Split splittable
  // wrappers at the endpoint's block boundary first; refuse for the rest.
  const tr = state.tr;
  const splitOutcome = splitPartialWrappers(tr, range, $from, $to);
  if (splitOutcome === "refused") return "refused";

  // Recompute the covered range on the (possibly split) doc.
  const $newFrom = tr.doc.resolve(tr.mapping.map($from.pos));
  const $newTo = tr.doc.resolve(tr.mapping.map($to.pos, -1));
  const newRange = $newFrom.blockRange($newTo);
  /* v8 ignore next -- @preserve defensive: mapped positions stay resolvable */
  if (!newRange) return "notApplicable";

  const lines: string[] = [];
  for (let i = newRange.startIndex; i < newRange.endIndex; i++) {
    collectBlockLines(newRange.parent.child(i), 0, lines);
  }
  // Same transaction as the splits — the whole conversion is ONE undo step.
  return applyCodeBlockReplacement(view, tr, newRange.start, newRange.end, lines.join("\n"));
}

/**
 * Handle the insertCodeBlock toolbar action. A selection inside a list turns
 * the whole list into one code block (one line per item); a selection across
 * several blocks merges them into one code block; otherwise Tiptap's
 * setCodeBlock converts the current textblock. A REFUSED conversion returns
 * false without invoking the fallback — the doc is unchanged, and the
 * fallback would consume or shatter what the refusal protected.
 */
export function handleInsertCodeBlock(context: WysiwygToolbarContext): boolean {
  const { view, editor } = context;
  if (!editor) return false;

  if (view) {
    const listOutcome = convertListToCodeBlock(view);
    if (listOutcome !== "notApplicable") return listOutcome === "converted";
    const selectionOutcome = convertSelectionToCodeBlock(view);
    if (selectionOutcome !== "notApplicable") return selectionOutcome === "converted";
  }

  // Propagate the command result: an unsupported selection (e.g. a selected
  // horizontal rule) leaves the doc unchanged and must not report success.
  return editor.chain().focus().setCodeBlock().run();
}
