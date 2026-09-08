/**
 * W05 — noEmptyLinkHref
 *
 * Purpose: Flag link nodes where the URL/href is an empty string.
 * Valid markdown but almost always a mistake.
 */

import { visit } from "unist-util-visit";
import type { Root, Link } from "mdast";
import { createDiagnostic, type LintDiagnostic } from "../types";
import { ruleEmission } from "../ruleMeta";

export function noEmptyLinkHref(_source: string, mdast: Root): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  visit(mdast, "link", (node: Link) => {
    if (!node.position) return;

    if (node.url === "") {
      const { line, column, offset } = node.position.start;
      diagnostics.push(
        createDiagnostic({
          ...ruleEmission("W05"),
          messageKey: "lint.W05",
          messageParams: {},
          line,
          column,
          offset: offset ?? 0,
          endOffset: node.position.end.offset,
          uiHint: "exact",
        })
      );
    }
  });

  return diagnostics;
}
