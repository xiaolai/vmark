/**
 * E07 — noDuplicateDefs
 *
 * Purpose: Flag definition nodes whose label has already appeared in the document.
 * Uses CommonMark label normalization (case-insensitive, whitespace-collapsed).
 * First occurrence wins; second+ are flagged.
 *
 * Position is required only to REPORT, never to remember (audit R3 #816). The
 * rule used to `return` before recording the label when a node carried no
 * position, so a positionless first occurrence made the next real one look
 * like the first and the duplicate went unreported.
 *
 * The dedup key is the parser's own `identifier` where it exists (#817).
 * micromark normalizes it with CommonMark's case fold — `toLowerCase()`,
 * `toUpperCase()`, `toLowerCase()` again — which `normalizeLabel`'s single
 * `toLowerCase()` does not reproduce: Greek final sigma `ς` lowercases to
 * itself, so `[ς]` and `[σ]` are one label to the parser and were two here.
 * `normalizeLabel` stays as the fallback for synthetic trees with no
 * identifier, and `label` stays the string shown to the user. The reported
 * offset comes from `startOffset` — the shared answer to a position the parser
 * left without one (#856).
 */

import { visit } from "unist-util-visit";
import type { Definition } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { startOffset } from "./positionOffset";
import { normalizeLabel } from "./labelUtils";

export const noDuplicateDefs: LintRule = (_source, mdast, { lineOffsets }) => {
  const diagnostics: LintDiagnostic[] = [];
  const seenLabels = new Set<string>();

  visit(mdast, "definition", (node: Definition) => {
    const raw = node.label ?? node.identifier ?? "";
    const key = node.identifier ?? normalizeLabel(raw);

    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      return;
    }
    if (!node.position) return;

    const { line, column } = node.position.start;
    diagnostics.push(
      createDiagnostic({
        ...ruleEmission("E07"),
        messageKey: "lint.E07",
        messageParams: { ref: raw },
        line,
        column,
        offset: startOffset(node.position.start, lineOffsets),
        endOffset: node.position.end.offset,
        uiHint: "exact",
      })
    );
  });

  return diagnostics;
};
