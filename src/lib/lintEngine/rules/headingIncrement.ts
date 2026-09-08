/**
 * W01 — headingIncrement
 *
 * Purpose: Flag headings that skip levels (e.g., h1 → h3).
 * Decreasing levels (e.g., h3 → h1) are always fine.
 * The first heading sets the baseline — no prior context to compare.
 */

import { visit } from "unist-util-visit";
import type { Root, Heading } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { startOffset } from "./positionOffset";

/** The W01 diagnostic for a heading that jumped from `from` to `to`. */
function levelSkip(
  node: Heading & { position: NonNullable<Heading["position"]> },
  from: number,
  lineOffsets: readonly number[],
): LintDiagnostic {
  const { line, column } = node.position.start;
  return createDiagnostic({
    ...ruleEmission("W01"),
    messageKey: "lint.W01",
    messageParams: { from: String(from), to: String(node.depth) },
    line,
    column,
    offset: startOffset(node.position.start, lineOffsets),
    endOffset: node.position.end.offset,
    uiHint: "exact",
  });
}

export function headingIncrement(
  _source: string,
  mdast: Root,
  { lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  let prevDepth: number | null = null;

  visit(mdast, "heading", (node: Heading) => {
    if (prevDepth !== null && node.depth > prevDepth + 1 && node.position) {
      diagnostics.push(
        levelSkip(node as Heading & { position: NonNullable<Heading["position"]> }, prevDepth, lineOffsets),
      );
    }
    prevDepth = node.depth;
  });

  return diagnostics;
}
