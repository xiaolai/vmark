import { NodeSelection, Selection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Fragment, Slice, type Schema, type Node as PMNode } from "@tiptap/pm/model";
import { parseMarkdownToTiptapDoc, serializeTiptapDocToMarkdown } from "@/utils/tiptapMarkdown";
import { useSourcePeekStore, type SourcePeekAnchorRect, type SourcePeekRange } from "@/stores/sourcePeekStore";

function createDocFromSlice(schema: Schema, slice: Slice): PMNode {
  const docType = schema.topNodeType;
  const paragraphType = schema.nodes.paragraph;
  let content = slice.content;

  if (content.childCount === 0 && paragraphType) {
    content = Fragment.from(paragraphType.create());
  }

  const firstChild = content.firstChild;
  if (firstChild && !firstChild.isBlock && paragraphType) {
    content = Fragment.from(paragraphType.create(null, content));
  }

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

export function serializeSourcePeekRange(state: EditorState, range: SourcePeekRange): string {
  const slice = state.doc.slice(range.from, range.to);
  const doc = createDocFromSlice(state.schema, slice);
  return serializeTiptapDocToMarkdown(doc);
}

export function createSourcePeekSlice(schema: Schema, markdown: string): Slice {
  const parsed = parseMarkdownToTiptapDoc(schema, markdown);
  const paragraphType = schema.nodes.paragraph;
  let content = parsed.content;

  if (content.childCount === 0 && paragraphType) {
    content = Fragment.from(paragraphType.create());
  }

  return new Slice(content, 0, 0);
}

export function applySourcePeekMarkdown(
  view: EditorView,
  range: SourcePeekRange,
  markdown: string
): boolean {
  try {
    const slice = createSourcePeekSlice(view.state.schema, markdown);
    const tr = view.state.tr.replaceRange(range.from, range.to, slice);
    const nextPos = Math.min(range.from + 1, tr.doc.content.size);
    tr.setSelection(Selection.near(tr.doc.resolve(nextPos)));
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
): SourcePeekAnchorRect {
  const safeTo = range.to > range.from ? range.to - 1 : range.to;
  const start = view.coordsAtPos(range.from);
  const end = view.coordsAtPos(safeTo);

  return {
    top: Math.min(start.top, end.top),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
    bottom: Math.max(start.bottom, end.bottom),
  };
}

export function openSourcePeek(view: EditorView): void {
  const range = getSourcePeekRange(view.state);
  const markdown = serializeSourcePeekRange(view.state, range);
  const anchorRect = getSourcePeekAnchorRect(view, range);
  useSourcePeekStore.getState().open({ markdown, range, anchorRect });
}
