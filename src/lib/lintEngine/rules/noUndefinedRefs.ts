/**
 * E01 — noUndefinedRefs
 *
 * Purpose: Flag reference-style links/images that have no matching definition.
 * Definitions come from the MDAST (they always parse); the references come from
 * the SOURCE, because remark does not keep `[text][unknown]` as a
 * `linkReference` when no definition exists — it falls back to literal text per
 * the CommonMark spec.
 *
 * What counts as scannable text is `sourceMask`'s answer, and what counts as a
 * reference is `referenceScanner`'s — both shared with W03. Until round 3 this
 * rule had its own fence tracker (blind to a fence a container prefixes), its
 * own `` `…` `` strip (blind to a double-backtick or multi-line span) and its
 * own definition-line regex (blind to a definition in a blockquote and to a
 * title carried onto a continuation line). W03 had already moved to the
 * parser's positions, so the two reported different things about one document.
 *
 * @coordinates-with src/lib/lintEngine/rules/sourceMask.ts — what is prose
 * @coordinates-with src/lib/lintEngine/rules/referenceScanner.ts — what is a reference
 * @coordinates-with src/lib/lintEngine/rules/noUnusedDefs.ts — the other half of the pair
 * @module lib/lintEngine/rules/noUndefinedRefs
 */

import { visit } from "unist-util-visit";
import type { Root, Definition } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { normalizeLabel } from "./labelUtils";
import { definitionLines, isDefinitionLine } from "./definitionLines";
import { referenceTokens } from "./referenceScanner";
import { maskedLines } from "./sourceMask";

export function noUndefinedRefs(
  _source: string,
  mdast: Root,
  { lines, lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const defined = new Set<string>();
  visit(mdast, "definition", (node: Definition) => {
    defined.add(normalizeLabel(node.label ?? node.identifier ?? ""));
  });

  const diagnostics: LintDiagnostic[] = [];
  const skip = definitionLines(mdast);
  const scannable = maskedLines(lines, mdast);

  for (let i = 0; i < scannable.length; i++) {
    if (skip.has(i + 1) || isDefinitionLine(scannable[i])) continue;

    for (const ref of referenceTokens(scannable[i])) {
      // A shortcut `[text]` is a reference only when a definition exists — and
      // then it resolves, so it is never an error. Without one CommonMark reads
      // it as literal text, which is not this rule's business either way.
      if (ref.kind === "shortcut" || defined.has(ref.label)) continue;

      const offset = lineOffsets[i] + ref.index;
      diagnostics.push(
        createDiagnostic({
          ...ruleEmission("E01"),
          messageKey: "lint.E01",
          messageParams: { ref: ref.raw },
          line: i + 1,
          column: ref.index + 1,
          offset,
          endOffset: offset + ref.text.length,
          uiHint: "exact",
        }),
      );
    }
  }

  return diagnostics;
}
