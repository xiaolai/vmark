import type { EditorView } from "@tiptap/pm/view";
import type { Node as PMNode, ResolvedPos } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { CursorInfo, NodeType } from "@/stores/documentStore";
import { getContentLineIndex } from "./markdown";
import { extractCursorContext, findBestPosition } from "./matching";

function getNodeTypeFromAncestors($pos: ResolvedPos): NodeType {
  for (let d = $pos.depth; d >= 0; d--) {
    const name = $pos.node(d).type.name;
    if (name === "heading") return "heading";
    if (name === "codeBlock") return "code_block";
    if (name === "blockquote") return "blockquote";
    if (name === "tableCell" || name === "tableHeader") return "table_cell";
    if (
      name === "listItem" ||
      name === "bulletList" ||
      name === "orderedList" ||
      name === "taskItem" ||
      name === "taskList"
    ) {
      return "list_item";
    }
  }
  return "paragraph";
}

interface LineInfo {
  text: string;
  start: number;
  end: number;
  nodeType: NodeType;
}

function buildLinesFromDoc(doc: PMNode): LineInfo[] {
  const lines: LineInfo[] = [];

  doc.descendants((node, nodePos) => {
    if (node.isBlock && node.isTextblock) {
      const lineText = node.textContent;
      const lineStart = nodePos + 1; // +1 for opening tag
      const $pos = doc.resolve(lineStart);
      lines.push({
        text: lineText,
        start: lineStart,
        end: lineStart + node.content.size,
        nodeType: getNodeTypeFromAncestors($pos),
      });
    }
    return true;
  });

  return lines;
}

export function getCursorInfoFromTiptap(view: EditorView): CursorInfo {
  const { state } = view;
  const { from } = state.selection;

  const lineInfos = buildLinesFromDoc(state.doc);
  const lines = lineInfos.map((l) => l.text);

  let lineNumber = 0;
  let column = 0;
  let nodeType: NodeType = "paragraph";

  for (let i = 0; i < lineInfos.length; i++) {
    const info = lineInfos[i];
    if (from >= info.start && from <= info.end) {
      lineNumber = i;
      column = from - info.start;
      nodeType = info.nodeType;
      break;
    }
  }

  const contentLineIndex = getContentLineIndex(lines, lineNumber);
  const lineText = lines[lineNumber] || "";
  const context = extractCursorContext(lineText, column);
  const percentInLine = lineText.length > 0 ? column / lineText.length : 0;

  return {
    contentLineIndex,
    wordAtCursor: context.word,
    offsetInWord: context.offsetInWord,
    nodeType,
    percentInLine,
    contextBefore: context.contextBefore,
    contextAfter: context.contextAfter,
  };
}

export function restoreCursorInTiptap(view: EditorView, cursorInfo: CursorInfo): void {
  const { state } = view;

  const lineInfos = buildLinesFromDoc(state.doc);
  const lines = lineInfos.map((l) => l.text);

  const result = findBestPosition(
    lines,
    cursorInfo.contentLineIndex,
    {
      word: cursorInfo.wordAtCursor,
      offsetInWord: cursorInfo.offsetInWord,
      contextBefore: cursorInfo.contextBefore,
      contextAfter: cursorInfo.contextAfter,
    },
    cursorInfo.percentInLine
  );

  if (result.line < lineInfos.length) {
    const lineInfo = lineInfos[result.line];
    let pos = Math.min(lineInfo.start + result.column, lineInfo.end);

    if (cursorInfo.percentInLine >= 0.99) {
      pos = lineInfo.end;
    }

    const clampedPos = Math.max(0, Math.min(pos, state.doc.content.size));

    try {
      const tr = state.tr.setSelection(TextSelection.near(state.doc.resolve(clampedPos)));
      view.dispatch(tr.scrollIntoView());
    } catch {
      const tr = state.tr.setSelection(Selection.atStart(state.doc));
      view.dispatch(tr.scrollIntoView());
    }
  }
}

