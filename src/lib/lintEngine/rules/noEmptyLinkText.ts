/**
 * E06 — noEmptyLinkText
 *
 * Purpose: Flag link nodes with nothing a reader can see or click.
 *
 * "Nothing" is not "no text after trimming". Inline code and an image are
 * CONTENT even when their own value is blank: `[` `](url)` shows a code span
 * and `[![](/a.png)](url)` shows a picture, and both were reported as empty
 * because their value was appended and then trimmed away (audit 20260907
 * round 3, #818). Content-bearing nodes are tracked as presence, not as text.
 *
 * @module lib/lintEngine/rules/noEmptyLinkText
 */

import { visit } from "unist-util-visit";
import type { Root, Link, PhrasingContent } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { startOffset } from "./positionOffset";

/** Leaf types that a reader perceives whatever their own value says. */
const CONTENT_BEARING: ReadonlySet<string> = new Set(["inlineCode", "image", "imageReference"]);

/** Whether `children` render anything at all — visible text, or a content node. */
function hasVisibleContent(children: PhrasingContent[]): boolean {
  for (const child of children) {
    if (CONTENT_BEARING.has(child.type)) return true;
    if (child.type === "text") {
      if (child.value.trim() !== "") return true;
      continue;
    }
    const nested = (child as { children?: PhrasingContent[] }).children;
    if (Array.isArray(nested) && hasVisibleContent(nested)) return true;
  }
  return false;
}

export function noEmptyLinkText(
  _source: string,
  mdast: Root,
  { lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];

  visit(mdast, "link", (node: Link) => {
    if (!node.position) return;
    if (hasVisibleContent(node.children)) return;

    const { line, column } = node.position.start;
    diagnostics.push(
      createDiagnostic({
        ...ruleEmission("E06"),
        messageKey: "lint.E06",
        messageParams: {},
        line,
        column,
        offset: startOffset(node.position.start, lineOffsets),
        endOffset: node.position.end.offset,
        uiHint: "exact",
      }),
    );
  });

  return diagnostics;
}
