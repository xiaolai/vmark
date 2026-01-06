import type { EditorView } from "@tiptap/pm/view";
import type { HeadingInfo, ContextMode, CodeBlockInfo } from "@/stores/formatToolbarStore";
import { findWordAtCursor } from "@/plugins/syntaxReveal/marks";

export function getCodeBlockInfo(view: EditorView): CodeBlockInfo | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "codeBlock") {
      return {
        language: node.attrs.language || "",
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

export function getHeadingInfo(view: EditorView): HeadingInfo | null {
  const { $from } = view.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "heading") {
      return {
        level: node.attrs.level || 1,
        nodePos: $from.before(d),
      };
    }
  }
  return null;
}

export function isAtParagraphLineStart(view: EditorView): boolean {
  const { $from } = view.state.selection;

  if ($from.parentOffset !== 0) {
    const textBefore = $from.parent.textContent.slice(0, $from.parentOffset);
    if (textBefore.trim() !== "") {
      return false;
    }
  }

  if ($from.parent.type.name !== "paragraph") {
    return false;
  }

  if ($from.parent.textContent.trim() === "") {
    return false;
  }

  for (let d = $from.depth - 1; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === "listItem" || name === "bulletList" || name === "orderedList" || name === "blockquote" || name === "codeBlock") {
      return false;
    }
  }

  return true;
}

export function getCursorRect(view: EditorView) {
  const { from, to } = view.state.selection;
  const start = view.coordsAtPos(from);
  const end = view.coordsAtPos(to);

  return {
    top: Math.min(start.top, end.top),
    bottom: Math.max(start.bottom, end.bottom),
    left: Math.min(start.left, end.left),
    right: Math.max(start.right, end.right),
  };
}

export function getContextMode(view: EditorView): ContextMode {
  const { empty } = view.state.selection;

  if (!empty) return "format";

  const $from = view.state.selection.$from;
  const wordRange = findWordAtCursor($from as unknown as Parameters<typeof findWordAtCursor>[0]);
  if (wordRange) return "format";

  const parent = $from.parent;
  const atStart = $from.parentOffset === 0;
  const isEmpty = parent.textContent.trim() === "";

  if (atStart && isEmpty) return "block-insert";

  return "inline-insert";
}

