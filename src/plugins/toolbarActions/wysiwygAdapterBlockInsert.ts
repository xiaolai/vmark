/**
 * Purpose: the WYSIWYG side of the fenced-block inserts — math, mermaid,
 * graphviz, markmap.
 *
 * All four converge with Source through ONE rule pair: a selection converts the
 * enclosing block(s) via the shared `handleInsertCodeBlock` path, and an empty
 * caret appends a new block AFTER the enclosing one rather than splitting it.
 * Both halves used to be wrong here — `insertContent` split a paragraph
 * mid-word and serialised the orphaned space as `&#x20;`, and only the selected
 * CHARACTERS became the block, deleting the rest of the line.
 *
 * Split out of `wysiwygAdapterInsert.ts` when the fixes pushed that file past
 * its size baseline.
 *
 * @coordinates-with plugins/toolbarActions/wysiwygAdapterCodeBlock.ts — the shared conversion
 * @coordinates-with plugins/toolbarActions/sourceInsertActions.ts — the Source counterpart
 * @coordinates-with plugins/toolbarActions/__tests__/parity — the gate that forced convergence
 * @module plugins/toolbarActions/wysiwygAdapterBlockInsert
 */

import { DEFAULT_MERMAID_DIAGRAM } from "@/plugins/mermaid/constants";
import { DEFAULT_GRAPHVIZ_DIAGRAM } from "@/plugins/graphviz/constants";
import { DEFAULT_MARKMAP_CONTENT } from "@/plugins/markmap/constants";
import { blockInsertPos } from "@/plugins/shared/blockInsertPos";
import { MATH_BLOCK_LANGUAGE } from "@/utils/markdownPipeline/mdastBlockConverters";
import { handleInsertCodeBlock } from "./wysiwygAdapterCodeBlock";
import type { WysiwygToolbarContext } from "./types";

/**
 * Insert a code block of `language`. A non-empty selection becomes the block
 * content (mirroring source mode, which wraps the selection in the fence);
 * otherwise `defaultText` is used.
 */
function insertLanguageBlock(
  context: WysiwygToolbarContext,
  language: string,
  defaultText: string,
): boolean {
  const editor = context.editor;
  if (!editor) return false;

  const { selection } = editor.state;

  // AFTER the enclosing block, not at the caret. `insertContent` split the
  // paragraph mid-word — "The quick |brown fox" became "The quick " + the new
  // block + "brown fox", and the trailing space was serialised as `&#x20;`
  // straight into the user's file. Source has always appended, as does the
  // already-converged `insertDetails`: a caret with no selection is a request
  // to CREATE a block, not to convert the prose the caret happens to sit in.
  // `insertCodeBlock` still wraps, and that is the real distinction —
  // "convert this block" versus "insert a new one".
  // A SELECTION converts the enclosing block(s), exactly as `insertCodeBlock`
  // does — same helper, threaded with a language. Taking only the selected
  // CHARACTERS is the data-loss shape the ledger already retired once: folding
  // them into a block that replaces whole lines deletes the rest of the line.
  if (!selection.empty) return handleInsertCodeBlock(context, language);

  const content = defaultText ? [{ type: "text", text: defaultText }] : [];
  editor
    .chain()
    .focus()
    .insertContentAt(blockInsertPos(selection), {
      type: "codeBlock",
      attrs: { language },
      content,
    })
    .run();
  return true;
}

/**
 * Insert a `$$` math block (selection becomes the formula).
 *
 * The MATH_BLOCK_LANGUAGE SENTINEL, not `"latex"`. Both render through KaTeX
 * inside VMark, so this looked cosmetic — it is not. `$$` parses to a codeBlock
 * carrying the sentinel and serialises back to `$$`; a `"latex"` codeBlock
 * serialises to a ```latex FENCE, which GitHub, Obsidian and Pandoc all render
 * as source code rather than math. The math button now emits portable math.
 *
 * Seeded with nothing, unlike its diagram siblings: a formula is a specific
 * expression the user already has in mind, where a sample becomes junk to
 * delete. Diagram syntax is scaffolding-heavy and keeps its template. Empty is
 * a designed state — `math-preview-empty` styles it with an "Empty" label.
 */
export function insertMathBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, MATH_BLOCK_LANGUAGE, "");
}

/** Insert a Mermaid diagram code block (selection becomes the diagram source). */
export function insertDiagramBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "mermaid", DEFAULT_MERMAID_DIAGRAM);
}

/** Insert a Graphviz DOT diagram code block (selection becomes the DOT source). */
export function insertGraphvizBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "dot", DEFAULT_GRAPHVIZ_DIAGRAM);
}

/** Insert a Markmap mind-map code block (selection becomes the outline). */
export function insertMarkmapBlock(context: WysiwygToolbarContext): boolean {
  return insertLanguageBlock(context, "markmap", DEFAULT_MARKMAP_CONTENT);
}
