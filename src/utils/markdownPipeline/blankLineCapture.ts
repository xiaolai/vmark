/**
 * blankLineCapture
 *
 * Purpose: Capture inter-block blank-line runs (>1) from MDAST positions into a
 * nullable `blankLinesBefore` attribute on the following top-level block, so the
 * run can be re-emitted on serialize (blank-line preservation, WI-1.2/ADR-4).
 * Extracted from mdastToProseMirror.ts to keep that orchestrator small.
 *
 * Capture is UNCONDITIONAL (ADR-4): whether it is re-emitted is decided at
 * serialize time, so toggling the setting needs no reparse. Runs of 0/1 are
 * left null (the serializer's default separator) and long runs clamp to
 * MAX_BLANK_LINES (ADR-6). Positions come straight from the parser (list
 * normalization is a parser-side remark plugin), and the >1 threshold keeps
 * ordinary single separators untouched.
 *
 * @coordinates-with mdastToProseMirror.ts — sole caller
 * @coordinates-with plugins/shared/sourceLineAttr.ts — the blankLinesBefore attr
 * @module utils/markdownPipeline/blankLineCapture
 */
import type { Node as PMNode } from "@tiptap/pm/model";
import type { Content, Root } from "mdast";

/** Maximum captured blank-line run (ADR-6) — guards against a pathological file. */
export const MAX_BLANK_LINES = 10;

/**
 * Number of blank lines to capture before a block, or null to inherit the
 * serializer's default. Null for a missing position and for runs of 0/1;
 * clamped to MAX_BLANK_LINES.
 */
function captureBlankLinesBefore(
  prevEndLine: number | null,
  startLine: number | undefined,
): number | null {
  if (prevEndLine === null || typeof startLine !== "number") return null;
  const gap = startLine - prevEndLine - 1;
  if (gap <= 1) return null;
  return Math.min(gap, MAX_BLANK_LINES);
}

/**
 * Copy of `node` carrying the blankLinesBefore attribute. A no-op on nodes
 * whose schema doesn't declare it (PM's computeAttrs ignores undeclared keys),
 * so it is safe to call on any block type.
 */
function withBlankLinesBefore(node: PMNode, n: number): PMNode {
  return node.type.create({ ...node.attrs, blankLinesBefore: n }, node.content, node.marks);
}

/**
 * Convert the top-level MDAST children to PM nodes, stamping blankLinesBefore
 * on the first node of any child preceded by a >1 blank-line run. Per-child
 * iteration (not a batch convert) preserves behavior — block context does no
 * inline normalization — while giving each child's position for the gap.
 */
export function convertTopLevelWithBlankLines(
  root: Root,
  convertNode: (child: Content) => PMNode | PMNode[] | null,
): PMNode[] {
  const topChildren: PMNode[] = [];
  let prevEndLine: number | null = null;
  for (const child of root.children) {
    const converted = convertNode(child);
    const nodes = converted ? (Array.isArray(converted) ? converted : [converted]) : [];
    if (nodes.length > 0) {
      const captured = captureBlankLinesBefore(prevEndLine, child.position?.start?.line);
      if (captured !== null) {
        nodes[0] = withBlankLinesBefore(nodes[0], captured);
      }
    }
    const endLine = child.position?.end?.line;
    if (typeof endLine === "number") prevEndLine = endLine;
    topChildren.push(...nodes);
  }
  return topChildren;
}
