import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Schema, type Node as PMNode, type NodeType } from "@tiptap/pm/model";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import type { MarkdownPipelineOptions } from "@/utils/markdownPipeline/types";
import { useSourcePeekStore, type SourcePeekAnchorRect, type SourcePeekRange } from "@/stores/sourcePeekStore";

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

export function getSourcePeekRange(state: EditorState): SourcePeekRange {
  const { selection } = state;

  if (selection instanceof NodeSelection && selection.node.isBlock) {
    return { from: selection.from, to: selection.to };
  }

  const { $from, $to } = selection;
  if ($from.depth >= 1 && $to.depth >= 1) {
    return {
      from: $from.start(1),
      to: $to.end(1),
    };
  }

  return { from: selection.from, to: selection.to };
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

export function getSourcePeekAnchorRect(
  view: EditorView,
  range: SourcePeekRange
): SourcePeekAnchorRect | null {
  try {
    const safeTo = range.to > range.from ? range.to - 1 : range.to;
    const start = view.coordsAtPos(range.from);
    const end = view.coordsAtPos(safeTo);

    return {
      top: Math.min(start.top, end.top),
      left: Math.min(start.left, end.left),
      right: Math.max(start.right, end.right),
      bottom: Math.max(start.bottom, end.bottom),
    };
  } catch {
    // Position may be stale or view not rendered - return null to skip popup
    return null;
  }
}

export function openSourcePeek(
  view: EditorView,
  options: MarkdownPipelineOptions = {}
): void {
  const range = getSourcePeekRange(view.state);
  const anchorRect = getSourcePeekAnchorRect(view, range);
  // Skip if coordinates couldn't be resolved (stale view or empty doc)
  if (!anchorRect) return;

  const markdown = serializeSourcePeekRange(view.state, range, options);
  useSourcePeekStore.getState().open({ markdown, range, anchorRect });
}
