/**
 * W02 — requireAltText
 *
 * Purpose: Flag image nodes with empty or missing alt text (WCAG 1.1.1).
 *
 * BOTH image spellings are visited (audit R3 #855). A reference-style image
 * (`![][logo]`) is an `imageReference` node, not an `image`, and carries the
 * same `alt` field — so a document that stores its URLs in reference
 * definitions escaped W02 entirely.
 *
 * The offset comes from `startOffset` rather than `offset ?? 0` (#856): a
 * positioned node whose optional `start.offset` is absent used to be reported
 * at offset 0, which navigates the user to the top of the document instead of
 * to the image. That fallback was written in five rules; it lives in
 * `positionOffset.ts` now.
 */

import { visit } from "unist-util-visit";
import type { Image, ImageReference } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintRule } from "../types";
import { ruleEmission } from "../ruleMeta";
import { startOffset } from "./positionOffset";

export const requireAltText: LintRule = (_source, mdast, { lineOffsets }) => {
  const diagnostics: LintDiagnostic[] = [];

  visit(mdast, ["image", "imageReference"], (visited) => {
    const node = visited as Image | ImageReference;
    if (!node.position) return;

    const alt = node.alt ?? "";
    if (alt.trim() !== "") return;

    const { line, column } = node.position.start;
    diagnostics.push(
      createDiagnostic({
        ...ruleEmission("W02"),
        messageKey: "lint.W02",
        messageParams: {},
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
