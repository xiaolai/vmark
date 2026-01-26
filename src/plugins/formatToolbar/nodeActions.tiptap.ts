import type { EditorView } from "@tiptap/pm/view";
import { Selection } from "@tiptap/pm/state";
import type { NodeContext } from "./types";
import { liftListItem, sinkListItem, wrapInList } from "@tiptap/pm/schema-list";

export function getNodeContext(view: EditorView): NodeContext {
  const { $from } = view.state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    const typeName = node.type.name;

    if (typeName === "table") {
      const tablePos = $from.before(d);
      const rowIndex = $from.depth > d ? $from.index(d) : 0;
      const colIndex = $from.depth > d + 1 ? $from.index(d + 1) : 0;
      const numRows = node.childCount;
      const numCols = numRows > 0 ? node.child(0).childCount : 0;

      return {
        type: "table",
        tablePos,
        rowIndex,
        colIndex,
        numRows,
        numCols,
      };
    }

    if (typeName === "bulletList" || typeName === "orderedList") {
      const listType = typeName === "orderedList" ? "ordered" : "bullet";
      let depth = 0;

      for (let dd = 1; dd < d; dd++) {
        const ancestorName = $from.node(dd).type.name;
        if (ancestorName === "bulletList" || ancestorName === "orderedList") {
          depth++;
        }
      }

      return {
        type: "list",
        listType,
        nodePos: $from.before(d),
        depth,
      };
    }

    if (typeName === "blockquote") {
      let depth = 0;
      for (let dd = 1; dd < d; dd++) {
        if ($from.node(dd).type.name === "blockquote") {
          depth++;
        }
      }

      return {
        type: "blockquote",
        nodePos: $from.before(d),
        depth,
      };
    }
  }

  return null;
}

export function handleListIndent(view: EditorView) {
  const listItemType = view.state.schema.nodes.listItem;
  if (!listItemType) return;
  view.focus();
  sinkListItem(listItemType)(view.state, view.dispatch);
}

export function handleListOutdent(view: EditorView) {
  const listItemType = view.state.schema.nodes.listItem;
  if (!listItemType) return;
  view.focus();
  liftListItem(listItemType)(view.state, view.dispatch);
}

export function handleToBulletList(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "bulletList") {
      view.focus();
      return;
    }
    if (node.type.name === "orderedList") {
      convertListType(view, d, "bulletList");
      view.focus();
      return;
    }
  }

  const bulletListType = state.schema.nodes.bulletList;
  if (!bulletListType) return;
  wrapInList(bulletListType)(state, dispatch);
  view.focus();
}

export function handleToOrderedList(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "orderedList") {
      view.focus();
      return;
    }
    if (node.type.name === "bulletList") {
      convertListType(view, d, "orderedList");
      view.focus();
      return;
    }
  }

  const orderedListType = state.schema.nodes.orderedList;
  if (!orderedListType) return;
  wrapInList(orderedListType, { start: 1 })(state, dispatch);
  view.focus();
}

export function handleRemoveList(view: EditorView) {
  const listItemType = view.state.schema.nodes.listItem;
  if (!listItemType) return;

  const maxLifts = 10;
  for (let i = 0; i < maxLifts; i++) {
    const { $from } = view.state.selection;
    let inList = false;
    for (let d = $from.depth; d > 0; d--) {
      const name = $from.node(d).type.name;
      if (name === "bulletList" || name === "orderedList") {
        inList = true;
        break;
      }
    }
    if (!inList) break;
    liftListItem(listItemType)(view.state, view.dispatch);
  }

  view.focus();
}

function convertListType(view: EditorView, listDepth: number, newListType: "bulletList" | "orderedList") {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  const listNode = $from.node(listDepth);
  const listPos = $from.before(listDepth);
  const newType = state.schema.nodes[newListType];

  if (!newType) return;

  dispatch(state.tr.setNodeMarkup(listPos, newType, listNode.attrs));
}

export function handleBlockquoteNest(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockquote") {
      const startPos = $from.before(d);
      const endPos = $from.after(d);

      const blockquoteType = state.schema.nodes.blockquote;
      if (!blockquoteType) return;

      const range = state.doc.resolve(startPos + 1).blockRange(state.doc.resolve(endPos - 1));
      if (!range) return;

      dispatch(state.tr.wrap(range, [{ type: blockquoteType }]));
      view.focus();
      return;
    }
  }
}

export function handleBlockquoteUnnest(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === "blockquote") {
      const range = $from.blockRange();
      if (range) {
        dispatch(state.tr.lift(range, d - 1));
      }
      view.focus();
      return;
    }
  }
}

export function handleRemoveBlockquote(view: EditorView) {
  const { state, dispatch } = view;
  const { $from } = state.selection;

  let outermostDepth = -1;
  for (let d = 1; d <= $from.depth; d++) {
    const node = $from.node(d);
    if (node.type.name === "blockquote") {
      outermostDepth = d;
      break;
    }
  }

  if (outermostDepth === -1) return;

  const blockquotePos = $from.before(outermostDepth);
  const blockquoteNode = $from.node(outermostDepth);

  // Calculate cursor offset within blockquote to preserve position after unwrap
  const cursorOffsetInBlockquote = $from.pos - blockquotePos - 1; // -1 for blockquote opening tag

  const tr = state.tr.replaceWith(blockquotePos, blockquotePos + blockquoteNode.nodeSize, blockquoteNode.content);

  // Restore cursor position: blockquotePos + offset within content
  const newCursorPos = Math.min(blockquotePos + cursorOffsetInBlockquote, tr.doc.content.size);
  tr.setSelection(Selection.near(tr.doc.resolve(newCursorPos)));

  dispatch(tr);
  view.focus();
}
