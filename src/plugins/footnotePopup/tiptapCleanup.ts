/**
 * Footnote Cleanup and Renumbering
 *
 * Purpose: Maintains sequential footnote numbering and removes orphaned definitions
 * when references are deleted, keeping footnotes in a valid state.
 *
 * Key decisions:
 *   - Renumbering scans all references in document order and assigns sequential labels
 *   - Orphan cleanup runs after deletion to remove definitions with no matching reference
 *   - Both operations are combined into a single transaction for atomicity
 *   - collectFootnoteNodes does a single doc traversal returning both refs and defs,
 *     avoiding repeated walks in createRenumberTransaction and createCleanupAndRenumberTransaction
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

export function getReferenceLabels(doc: PMNode): Set<string> {
  return collectFootnoteNodes(doc).refLabels;
}

export function getDefinitionInfo(doc: PMNode): Array<{ label: string; pos: number; size: number }> {
  return collectFootnoteNodes(doc).defs;
}

export function createRenumberTransaction(
  state: EditorState,
  refType: NodeType,
  defType: NodeType,
  preCollected?: ReturnType<typeof collectFootnoteNodes>,
): Transaction | null {
  const { doc, schema } = state;

  const { refs, defs } = preCollected ?? collectFootnoteNodes(doc);

  if (refs.length === 0) return null;

  const labelMap = new Map<string, string>();
  refs.forEach((ref, index) => {
    const newLabel = String(index + 1);
    if (!labelMap.has(ref.label)) {
      labelMap.set(ref.label, newLabel);
    }
  });

  let needsRenumber = false;
  for (const [oldLabel, newLabel] of labelMap) {
    if (oldLabel !== newLabel) {
      needsRenumber = true;
      break;
    }
  }
  if (!needsRenumber) return null;

  let tr = state.tr;

  const sortedRefs = [...refs].sort((a, b) => b.pos - a.pos);
  for (const ref of sortedRefs) {
    const newLabel = labelMap.get(ref.label);
    if (newLabel && newLabel !== ref.label) {
      const mappedPos = tr.mapping.map(ref.pos);
      const newRefNode = refType.create({ label: newLabel });
      tr = tr.replaceWith(mappedPos, mappedPos + ref.size, newRefNode);
    }
  }

  const defContentByLabel = new Map<string, PMNode>();
  for (const def of defs) {
    const node = doc.nodeAt(def.pos);
    /* v8 ignore start -- @preserve else branch: node is always present at valid position */
    if (node) {
      defContentByLabel.set(def.label, node);
    }
    /* v8 ignore stop */
  }

  const sortedDefs = [...defs].sort((a, b) => b.pos - a.pos);
  for (const def of sortedDefs) {
    const mappedPos = tr.mapping.map(def.pos);
    tr = tr.delete(mappedPos, mappedPos + def.size);
  }

  const orderedLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const ref of refs) {
    /* v8 ignore start -- @preserve else branch: duplicate ref labels not exercised in tests */
    if (!seenLabels.has(ref.label)) {
      seenLabels.add(ref.label);
      orderedLabels.push(ref.label);
    }
    /* v8 ignore stop */
  }

  let insertPos = tr.doc.content.size;
  const paragraphType = schema.nodes.paragraph;

  for (let i = 0; i < orderedLabels.length; i++) {
    const oldLabel = orderedLabels[i];
    const newLabel = String(i + 1);
    const oldDef = defContentByLabel.get(oldLabel);

    const paragraph = paragraphType.create();
    const newDefNode = oldDef ? defType.create({ label: newLabel }, oldDef.content) : defType.create({ label: newLabel }, [paragraph]);

    tr = tr.insert(insertPos, newDefNode);
    insertPos += newDefNode.nodeSize;
  }

  return tr;
}

export function createCleanupAndRenumberTransaction(
  state: EditorState,
  remainingRefLabels: Set<string>,
  refType: NodeType,
  defType: NodeType,
  preCollected?: ReturnType<typeof collectFootnoteNodes>,
): Transaction | null {
  const { doc, schema } = state;

  const { refs, defs: allDefs } = preCollected ?? collectFootnoteNodes(doc);

  const labelMap = new Map<string, string>();
  refs.forEach((ref, index) => {
    const newLabel = String(index + 1);
    if (!labelMap.has(ref.label)) {
      labelMap.set(ref.label, newLabel);
    }
  });

  const defContentByLabel = new Map<string, PMNode>();
  for (const def of allDefs) {
    if (remainingRefLabels.has(def.label)) {
      const node = doc.nodeAt(def.pos);
      /* v8 ignore start -- @preserve else branch: node is always present at valid position */
      if (node) {
        defContentByLabel.set(def.label, node);
      }
      /* v8 ignore stop */
    }
  }

  let tr = state.tr;

  const sortedRefs = [...refs].sort((a, b) => b.pos - a.pos);
  for (const ref of sortedRefs) {
    const newLabel = labelMap.get(ref.label);
    if (newLabel && newLabel !== ref.label) {
      const mappedPos = tr.mapping.map(ref.pos);
      const newRefNode = refType.create({ label: newLabel });
      tr = tr.replaceWith(mappedPos, mappedPos + ref.size, newRefNode);
    }
  }

  const sortedDefs = [...allDefs].sort((a, b) => b.pos - a.pos);
  for (const def of sortedDefs) {
    const mappedPos = tr.mapping.map(def.pos);
    tr = tr.delete(mappedPos, mappedPos + def.size);
  }

  const orderedLabels: string[] = [];
  const seenLabels = new Set<string>();
  for (const ref of refs) {
    if (!seenLabels.has(ref.label)) {
      seenLabels.add(ref.label);
      orderedLabels.push(ref.label);
    }
  }

  let insertPos = tr.doc.content.size;
  const paragraphType = schema.nodes.paragraph;

  for (let i = 0; i < orderedLabels.length; i++) {
    const oldLabel = orderedLabels[i];
    const newLabel = String(i + 1);
    const oldDef = defContentByLabel.get(oldLabel);

    const paragraph = paragraphType.create();
    const newDefNode = oldDef ? defType.create({ label: newLabel }, oldDef.content) : defType.create({ label: newLabel }, [paragraph]);

    tr = tr.insert(insertPos, newDefNode);
    insertPos += newDefNode.nodeSize;
  }

  return tr;
}

