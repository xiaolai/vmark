/**
 * Footnote Insertion
 *
 * Purpose: Creates and inserts a new footnote reference + definition pair at the
 * cursor position, automatically assigning the next sequential label.
 *
 * @coordinates-with tiptapCleanup.ts — renumbering after insertion
 * @coordinates-with stores/footnotePopupStore.ts — opens popup for new footnote editing
 * @module plugins/footnotePopup/tiptapInsertFootnote
 */

import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useFootnotePopupStore } from "@/stores/footnotePopupStore";
import { createRenumberTransaction, getDefinitionInfo } from "./tiptapCleanup";

function findNearestReference(doc: PMNode, insertPos: number): { label: string; pos: number } | null {
  let best: { label: string; pos: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  doc.descendants((node, pos) => {
    if (node.type.name !== "footnote_reference") return true;

    const distance = Math.abs(pos - insertPos);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { label: String(node.attrs.label ?? ""), pos };
    }
    return true;
  });

  return best;
}

export function insertFootnoteAndOpenPopup(editor: TiptapEditor): void {
  const { state, view } = editor;
  const { schema } = state;

  const refType = schema.nodes.footnote_reference;
  const defType = schema.nodes.footnote_definition;
  if (!refType || !defType) return;

  const insertPos = state.selection.to;
  view.dispatch(state.tr.insert(insertPos, refType.create({ label: "_new_" })));

  const renumberTr = createRenumberTransaction(view.state, refType, defType);
  if (renumberTr) {
    view.dispatch(renumberTr);
  }

  const ref = findNearestReference(view.state.doc, insertPos);
  if (!ref?.label) return;

  const defPos = getDefinitionInfo(view.state.doc).find((d) => d.label === ref.label)?.pos ?? null;

  requestAnimationFrame(() => {
    const refEl = view.dom.querySelector(
      `sup[data-type="footnote_reference"][data-label="${ref.label}"]`
    ) as HTMLElement | null;
    if (!refEl) return;

    useFootnotePopupStore.getState().openPopup(ref.label, "", refEl.getBoundingClientRect(), defPos, ref.pos, true);
  });
}

