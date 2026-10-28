/**
 * Footnote Cleanup and Renumbering
 *
 * Purpose: Maintains sequential footnote numbering and removes orphaned definitions
 * when references are deleted, keeping footnotes in a valid state.
 *
 * Key decisions:
 *   - Renumbering scans all references in document order and assigns sequential labels
 *   - Labels are numbered by DISTINCT label in first-seen order (duplicate references
 *     to the same footnote share one number), matching the distinct-label order used
 *     to recreate definitions — index-based numbering would desync refs from defs and
 *     let the appendTransaction orphan filter delete definition content
 *   - Orphan cleanup runs after deletion to remove definitions with no matching reference
 *   - Both operations are combined into a single transaction for atomicity
 *   - collectFootnoteNodes does a single doc traversal returning both refs and defs,
 *     avoiding repeated walks in createRenumberTransaction and createCleanupAndRenumberTransaction
 *   - Both transactions are built by one function (rebuildFootnotes); they differ only
 *     in when they apply and in which definitions keep their content (keepLabels)
 *   - A label with several definitions keeps the FIRST one's content, the one
 *     navigation resolves; the later duplicates are dropped by the rebuild
 *   - Recreated definitions go ahead of the document's trailing empty paragraphs:
 *     Tiptap's trailing-node extension keeps one after a final definition, and
 *     appending past it left a stray empty block before the definitions on
 *     every rebuild
 *
 * @coordinates-with tiptap.ts — calls these functions from appendTransaction
 * @coordinates-with tiptapNodes.ts — footnote node type definitions
 * @module plugins/footnotePopup/tiptapCleanup
 */

import type { EditorState, Transaction } from "@tiptap/pm/state";
import type { Node as PMNode, NodeType } from "@tiptap/pm/model";

export function collectFootnoteNodes(doc: PMNode): {
  refs: Array<{ label: string; pos: number; size: number }>;
  defs: Array<{ label: string; pos: number; size: number }>;
  refLabels: Set<string>;
} {
  const refs: Array<{ label: string; pos: number; size: number }> = [];
  const defs: Array<{ label: string; pos: number; size: number }> = [];
  const refLabels = new Set<string>();

  doc.descendants((node, pos) => {
    if (node.type.name === "footnote_reference") {
      const label = String(node.attrs.label ?? "");
      refs.push({ label, pos, size: node.nodeSize });
      refLabels.add(label);
    } else if (node.type.name === "footnote_definition") {
      defs.push({ label: String(node.attrs.label ?? ""), pos, size: node.nodeSize });
    }
    return true;
  });

  return { refs, defs, refLabels };
}

/**
 * True when any label has FEWER references in `newRefs` than in `oldRefs`.
 *
 * Deletion detection must compare per-label counts, not label sets: deleting
 * one of two duplicate refs ([1,2,1] → [2,1]) leaves the label set unchanged
 * but still requires renumbering (Codex audit finding).
 */
export function hasRefCountDropped(
  oldRefs: Array<{ label: string }>,
  newRefs: Array<{ label: string }>,
): boolean {
  const newCounts = new Map<string, number>();
  for (const ref of newRefs) {
    newCounts.set(ref.label, (newCounts.get(ref.label) ?? 0) + 1);
  }
  const oldCounts = new Map<string, number>();
  for (const ref of oldRefs) {
    oldCounts.set(ref.label, (oldCounts.get(ref.label) ?? 0) + 1);
  }
  for (const [label, count] of oldCounts) {
    if ((newCounts.get(label) ?? 0) < count) return true;
  }
  return false;
}

export function getDefinitionInfo(doc: PMNode): Array<{ label: string; pos: number; size: number }> {
  return collectFootnoteNodes(doc).defs;
}

type FootnoteNodes = ReturnType<typeof collectFootnoteNodes>;

/**
 * New label for each distinct reference label, in first-seen order. One map
 * numbers both the references and the recreated definitions, so they cannot
 * desync when a footnote is referenced more than once.
 */
function numberLabels(refs: FootnoteNodes["refs"]): Map<string, string> {
  const labelMap = new Map<string, string>();
  for (const ref of refs) {
    if (!labelMap.has(ref.label)) {
      labelMap.set(ref.label, String(labelMap.size + 1));
    }
  }
  return labelMap;
}

/**
 * Position where the run of empty top-level paragraphs that ends the document
 * starts; the document's end when it does not end in one.
 */
function trailingEmptyParagraphsStart(doc: PMNode): number {
  let pos = doc.content.size;
  for (let i = doc.childCount - 1; i >= 0; i -= 1) {
    const child = doc.child(i);
    if (child.type.name !== "paragraph" || child.content.size > 0) break;
    pos -= child.nodeSize;
  }
  return pos;
}

/**
 * Relabel every reference per `labelMap`, drop every definition, and append
 * one definition per referenced label in reference order, at the end of the
 * document but ahead of its trailing empty paragraphs. A definition's
 * content is carried over when its label is in `keepLabels` (all labels when
 * omitted); any other referenced label gets an empty definition.
 */
function rebuildFootnotes(
  state: EditorState,
  refType: NodeType,
  defType: NodeType,
  { refs, defs }: FootnoteNodes,
  labelMap: Map<string, string>,
  keepLabels?: Set<string>,
): Transaction {
  const { doc, schema } = state;

  const defContentByLabel = new Map<string, PMNode>();
  for (const def of defs) {
    if (keepLabels && !keepLabels.has(def.label)) continue;
    const node = doc.nodeAt(def.pos);
    // @edge-case Duplicate definitions of one label: keep the first, the one
    // navigation resolves (findFootnoteDefinition), never the last duplicate.
    if (node && !defContentByLabel.has(def.label)) {
      defContentByLabel.set(def.label, node);
    }
  }

  let tr = state.tr;

  // Back to front, so earlier positions stay valid while later ones change.
  const sortedRefs = [...refs].sort((a, b) => b.pos - a.pos);
  for (const ref of sortedRefs) {
    const newLabel = labelMap.get(ref.label);
    if (newLabel && newLabel !== ref.label) {
      const mappedPos = tr.mapping.map(ref.pos);
      const newRefNode = refType.create({ label: newLabel });
      tr = tr.replaceWith(mappedPos, mappedPos + ref.size, newRefNode);
    }
  }

  const sortedDefs = [...defs].sort((a, b) => b.pos - a.pos);
  for (const def of sortedDefs) {
    const mappedPos = tr.mapping.map(def.pos);
    tr = tr.delete(mappedPos, mappedPos + def.size);
  }

  // Before the document's trailing empty paragraphs, not after them: the
  // trailing-node extension keeps one after a final definition, and appending
  // past it would strand it between the body and the definitions.
  let insertPos = tr.mapping.map(trailingEmptyParagraphsStart(doc));
  for (const [oldLabel, newLabel] of labelMap) {
    const oldDef = defContentByLabel.get(oldLabel);
    const content = oldDef ? oldDef.content : [schema.nodes.paragraph.create()];
    const newDefNode = defType.create({ label: newLabel }, content);

    tr = tr.insert(insertPos, newDefNode);
    insertPos += newDefNode.nodeSize;
  }

  return tr;
}

/**
 * Renumber footnotes sequentially, keeping every definition's content.
 * Returns null when there are no references or the labels are already 1..n.
 */
export function createRenumberTransaction(
  state: EditorState,
  refType: NodeType,
  defType: NodeType,
  preCollected?: FootnoteNodes,
): Transaction | null {
  const collected = preCollected ?? collectFootnoteNodes(state.doc);
  if (collected.refs.length === 0) return null;

  const labelMap = numberLabels(collected.refs);
  const needsRenumber = [...labelMap].some(([oldLabel, newLabel]) => oldLabel !== newLabel);
  if (!needsRenumber) return null;

  return rebuildFootnotes(state, refType, defType, collected, labelMap);
}

/**
 * Remove orphaned definitions and renumber in one transaction. Only
 * definitions whose label is in `remainingRefLabels` keep their content.
 */
export function createCleanupAndRenumberTransaction(
  state: EditorState,
  remainingRefLabels: Set<string>,
  refType: NodeType,
  defType: NodeType,
  preCollected?: FootnoteNodes,
): Transaction | null {
  const collected = preCollected ?? collectFootnoteNodes(state.doc);
  return rebuildFootnotes(
    state,
    refType,
    defType,
    collected,
    numberLabels(collected.refs),
    remainingRefLabels,
  );
}
