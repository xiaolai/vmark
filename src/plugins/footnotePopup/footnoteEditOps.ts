/**
 * Footnote Edit Operations
 *
 * Purpose: Pure helpers behind FootnotePopupView's save/delete actions.
 * Delete: verify that stored positions still point at footnote nodes whose
 * `label` matches the popup's label (positions go stale when the document
 * changes under an open popup) and build the delete transaction from only
 * the verified nodes. Save: normalize parsed popup markdown down to the
 * single paragraph that footnote_definition's content spec accepts.
 *
 * Key decisions:
 *   - Label verification per node — a stale reference never causes the
 *     wrong footnote to be deleted; each node is deleted only if it is
 *     the right type AND carries the expected label
 *   - Deletions applied in descending position order so earlier positions
 *     stay valid within one transaction
 *   - Multi-block popup input is joined into one paragraph (blocks
 *     separated by a single space) because footnote_definition's content
 *     is exactly one paragraph — replaceWith would throw otherwise
 *
 * @coordinates-with FootnotePopupView.ts — handleSave/handleDelete call these helpers
 * @coordinates-with tiptapNodes.ts — footnote_definition content spec ("paragraph")
 * @module plugins/footnotePopup/footnoteEditOps
 */

import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

/** A node verified to still be the footnote the popup targets. */
export interface FootnoteDeletion {
  pos: number;
  node: PMNode;
}

/** Minimal doc surface needed for verification (keeps helpers testable). */
interface DocLike {
  nodeAt(pos: number): PMNode | null;
}

function verifiedNodeAt(
  doc: DocLike,
  pos: number | null,
  typeName: string,
  label: string
): FootnoteDeletion | null {
  if (pos === null) return null;
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== typeName) return null;
  if (node.attrs.label !== label) return null;
  return { pos, node };
}

/**
 * Collect the reference/definition nodes that are still verifiably the
 * footnote identified by `label`. Nodes that moved, changed type, or carry
 * a different label are excluded — deleting them would hit the wrong content.
 */
export function collectVerifiedFootnoteDeletions(
  doc: DocLike,
  label: string,
  referencePos: number | null,
  definitionPos: number | null
): FootnoteDeletion[] {
  const deletions: FootnoteDeletion[] = [];
  const ref = verifiedNodeAt(doc, referencePos, "footnote_reference", label);
  if (ref) deletions.push(ref);
  const def = verifiedNodeAt(doc, definitionPos, "footnote_definition", label);
  if (def) deletions.push(def);
  return deletions;
}

/**
 * Apply the verified deletions to a transaction, highest position first so
 * earlier positions remain valid. Returns null when there is nothing to
 * delete (caller should close without dispatching).
 */
export function buildDeleteFootnoteTransaction(
  tr: Transaction,
  deletions: FootnoteDeletion[]
): Transaction | null {
  if (deletions.length === 0) return null;
  let result = tr;
  for (const { pos, node } of [...deletions].sort((a, b) => b.pos - a.pos)) {
    result = result.delete(pos, pos + node.nodeSize);
  }
  return result;
}

/**
 * Normalize a parsed popup document to a single paragraph node, because
 * footnote_definition's content spec is exactly one paragraph. Multiple
 * blocks (e.g. the user typed a blank line) are joined with a single space;
 * non-textblock blocks contribute their plain text.
 */
export function normalizeToSingleParagraph(schema: Schema, parsedDoc: PMNode): PMNode {
  const blocks: PMNode[] = [];
  parsedDoc.forEach((child) => blocks.push(child));

  const paragraphType = schema.nodes.paragraph;
  if (blocks.length === 1 && blocks[0].type === paragraphType) {
    return blocks[0];
  }

  const chunks: PMNode[][] = [];
  for (const block of blocks) {
    const inline: PMNode[] = [];
    if (block.isTextblock) {
      block.forEach((child) => inline.push(child));
    } else if (block.textContent) {
      inline.push(schema.text(block.textContent));
    }
    if (inline.length > 0) chunks.push(inline);
  }

  const joined: PMNode[] = [];
  chunks.forEach((chunk, i) => {
    if (i > 0) joined.push(schema.text(" "));
    joined.push(...chunk);
  });

  return paragraphType.create(null, joined);
}
