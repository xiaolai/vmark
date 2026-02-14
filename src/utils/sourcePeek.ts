/**
 * Source Peek — Markdown ↔ PM Content Bridge
 *
 * Purpose: Provides the content conversion layer for "source peek" — the inline
 * markdown editing overlay that appears in WYSIWYG mode for code blocks, math, etc.
 *
 * Key decisions:
 *   - Converts PM selection to markdown for source peek display, and parses
 *     edited markdown back to PM content for replacement
 *   - ensureBlockContent wraps inline fragments in paragraphs to satisfy
 *     PM schema constraints (doc requires block children)
 *   - Uses ReplaceStep for surgical content replacement to preserve undo history
 *
 * @coordinates-with sourcePeekStore.ts — stores peek state (range, content)
 * @coordinates-with sourcePeekInline/tiptap.ts — renders the inline peek editor
 * @coordinates-with markdownPipeline/ — markdown ↔ PM conversion
 * @module utils/sourcePeek
 */

import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Schema, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";
import { type SourcePeekRange } from "@/stores/sourcePeekStore";

/**
 * Ensures content has at least one block node.
 * Wraps inline content in a paragraph if needed.
 */
function ensureBlockContent(content: Fragment, paragraphType: NodeType | undefined): Fragment {
  if (content.childCount === 0 && paragraphType) {
    return Fragment.from(paragraphType.create());
  }
  const firstChild = content.firstChild;
  if (firstChild && !firstChild.isBlock && paragraphType) {
    return Fragment.from(paragraphType.create(null, content));
  }
  return content;
}

function createDocFromSlice(schema: Schema, slice: Slice): PMNode {
  const docType = schema.topNodeType;
  const content = ensureBlockContent(slice.content, schema.nodes.paragraph);

  try {
    return docType.create(null, content);
  } catch {
    return docType.createAndFill() ?? docType.create();
  }
}

/**
 * Block types that should be edited as a complete unit.
 * When cursor is inside one of these, expand to include the entire block.
 */
export const COMPOUND_BLOCK_TYPES = new Set([
  "table",
  "bulletList",
  "orderedList",
  "blockquote",
  "detailsBlock",
  "taskList",
]);

/**
 * Get the range for Source Peek editing.
 * Returns the boundaries of the topmost block at cursor position.
 *
 * IMPORTANT: Uses before/after (not start/end) to include wrapper nodes.
 * - start/end: positions inside the node content
 * - before/after: positions including the node itself
 */
export function getSourcePeekRange(state: EditorState): SourcePeekRange {
  const { selection } = state;

  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return { from: selection.from, to: selection.to };
  }

  const { $from, $to } = selection;
  if ($from.depth >= 1 && $to.depth >= 1) {
    // Use before/after to include the wrapper node (not start/end)
    return {
      from: $from.before(1),
      to: $to.after(1),
    };
  }

  return { from: selection.from, to: selection.to };
}

/**
 * Get expanded range for Source Peek that includes compound blocks.
 * When cursor is inside a table, list, blockquote, etc., returns the
 * entire structure rather than just the immediate block.
 *
 * @returns Range expanded to include compound block ancestors
 */
export function getExpandedSourcePeekRange(state: EditorState): SourcePeekRange {
  const { selection } = state;
  const { $from, $to } = selection;

  // For node selections, use the node directly
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return { from: selection.from, to: selection.to };
  }

  // Find the topmost compound block ancestor that should be edited as a unit
  let targetDepth = 1;

  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (COMPOUND_BLOCK_TYPES.has(node.type.name)) {
      targetDepth = d;
      break; // Stop at first compound block (outermost)
    }
  }

  // Ensure we have valid depth
  if ($from.depth < targetDepth || $to.depth < targetDepth) {
    targetDepth = Math.min($from.depth, $to.depth);
  }

  if (targetDepth < 1) {
    return { from: selection.from, to: selection.to };
  }

  return {
    from: $from.before(targetDepth),
    to: $to.after(targetDepth),
  };
}

export function serializeSourcePeekRange(
  state: EditorState,
  range: SourcePeekRange,
  options: MarkdownPipelineOptions = {}
): string {
  const slice = state.doc.slice(range.from, range.to);
  const doc = createDocFromSlice(state.schema, slice);
  return serializeMarkdown(state.schema, doc, options);
}

export function createSourcePeekSlice(
  schema: Schema,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): Slice {
  const parsed = parseMarkdown(schema, markdown, options);
  const content = ensureBlockContent(parsed.content, schema.nodes.paragraph);
  return new Slice(content, 0, 0);
}

export function applySourcePeekMarkdown(
  view: EditorView,
  range: SourcePeekRange,
  markdown: string,
  options: MarkdownPipelineOptions = {}
): boolean {
  try {
    const slice = createSourcePeekSlice(view.state.schema, markdown, options);
    const tr = view.state.tr.replaceRange(range.from, range.to, slice);
    // Use transaction mapping to find correct cursor position after replacement
    const mappedPos = tr.mapping.map(range.from);
    const safePos = Math.min(mappedPos, tr.doc.content.size);
    tr.setSelection(Selection.near(tr.doc.resolve(safePos)));
    view.dispatch(tr.scrollIntoView());
    return true;
  } catch (error) {
    console.error("[SourcePeek] Failed to apply markdown:", error);
    return false;
  }
}
