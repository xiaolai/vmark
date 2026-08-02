/**
 * Semantic fingerprint of a parsed document.
 *
 * Purpose: let the fidelity gate DERIVE whether a round-trip changed meaning,
 * instead of trusting a human's classification of a text diff. Two documents
 * with the same fingerprint are the same document as far as the editor is
 * concerned; a fingerprint change is semantic corruption regardless of how
 * innocent the markdown diff looked.
 *
 * Positional bookkeeping is stripped: `sourceLine` and `blankLinesBefore` record
 * where a node came from, not what it means, and re-serializing legitimately
 * moves them. Everything else — node type, structural attributes, mark sets and
 * text — is significant.
 *
 * @coordinates-with roundtripFidelity.test.ts — the gate
 * @module utils/markdownPipeline/__tests__/fidelity/docFingerprint
 */
import type { Node as PMNode } from "@tiptap/pm/model";

/** Attributes that record provenance rather than meaning. */
const VOLATILE_ATTRS = new Set(["sourceLine", "blankLinesBefore"]);

function attrsOf(node: PMNode): string {
  const attrs = node.attrs ?? {};
  const significant = Object.keys(attrs)
    .filter((k) => !VOLATILE_ATTRS.has(k) && attrs[k] !== null && attrs[k] !== undefined)
    .sort()
    .map((k) => `${k}=${JSON.stringify(attrs[k])}`);
  return significant.length ? `{${significant.join(",")}}` : "";
}

function marksOf(node: PMNode): string {
  if (node.marks.length === 0) return "";
  const marks = node.marks
    .map((m) => {
      const keys = Object.keys(m.attrs ?? {})
        .filter((k) => m.attrs[k] !== null && m.attrs[k] !== undefined)
        .sort()
        .map((k) => `${k}=${JSON.stringify(m.attrs[k])}`);
      return keys.length ? `${m.type.name}{${keys.join(",")}}` : m.type.name;
    })
    .sort();
  return `<${marks.join("+")}>`;
}

/**
 * A stable, human-readable string identifying a document's meaning.
 *
 * Text nodes contribute their content, so a lost heading level, a dropped mark,
 * a changed URL or a deleted node all change the fingerprint.
 */
export function docFingerprint(doc: PMNode): string {
  const parts: string[] = [];
  const walk = (node: PMNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    if (node.isText) {
      parts.push(`${indent}text${marksOf(node)}:${JSON.stringify(node.text ?? "")}`);
      return;
    }
    parts.push(`${indent}${node.type.name}${attrsOf(node)}${marksOf(node)}`);
    node.forEach((child) => walk(child, depth + 1));
  };
  doc.forEach((child) => walk(child, 0));
  return parts.join("\n");
}
