/**
 * W03 — noUnusedDefs
 *
 * Purpose: Flag definition nodes no `linkReference`/`imageReference` uses.
 *
 * The uses are found in the SOURCE, not the tree, because the pipeline's
 * reference resolution rewrites `linkReference`/`imageReference` into
 * `link`/`image` before rules run — the reference node types are gone by then.
 *
 * What counts as scannable text is `sourceMask`'s answer and what counts as a
 * reference is `referenceScanner`'s, both shared with E01. Before round 3 this
 * rule's own code-span strip handled one backtick on one line, so a definition
 * "used" only inside a wider or multi-line span went unreported.
 *
 * @coordinates-with src/lib/lintEngine/rules/sourceMask.ts — what is prose
 * @coordinates-with src/lib/lintEngine/rules/referenceScanner.ts — what is a reference
 * @coordinates-with src/lib/lintEngine/rules/noUndefinedRefs.ts — the other half of the pair
 * @module lib/lintEngine/rules/noUnusedDefs
 */

import { visit } from "unist-util-visit";
import type { Root, Definition } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { normalizeLabel } from "./labelUtils";
import { definitionLines, isDefinitionLine } from "./definitionLines";
import { referenceTokens } from "./referenceScanner";
import { maskedLines } from "./sourceMask";
import { startOffset } from "./positionOffset";

/** Every normalized label the document actually USES. */
function referencedLabels(scannable: readonly string[], skip: ReadonlySet<number>): Set<string> {
  const used = new Set<string>();
  for (let i = 0; i < scannable.length; i++) {
    if (skip.has(i + 1) || isDefinitionLine(scannable[i])) continue;
    for (const ref of referenceTokens(scannable[i])) {
      // `[foo](url)` is an INLINE link, not a shortcut reference: counting one
      // marked an unrelated `[foo]: …` definition used and silenced this rule.
      if (ref.kind === "shortcut" && ref.inlineLink) continue;
      if (ref.label) used.add(ref.label);
    }
  }
  return used;
}

export function noUnusedDefs(
  _source: string,
  mdast: Root,
  { lines, lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const skip = definitionLines(mdast);
  const used = referencedLabels(maskedLines(lines, mdast), skip);
  const diagnostics: LintDiagnostic[] = [];

  visit(mdast, "definition", (node: Definition) => {
    if (!node.position) return;
    const raw = node.label ?? node.identifier ?? "";
    if (used.has(normalizeLabel(raw))) return;

    const { line, column } = node.position.start;
    diagnostics.push(
      createDiagnostic({
        ...ruleEmission("W03"),
        messageKey: "lint.W03",
        messageParams: { ref: raw },
        line,
        column,
        offset: startOffset(node.position.start, lineOffsets),
        endOffset: node.position.end.offset,
        uiHint: "block",
      }),
    );
  });

  return diagnostics;
}
