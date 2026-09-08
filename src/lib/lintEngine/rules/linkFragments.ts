/**
 * W04 — linkFragments
 *
 * Purpose: Flag links whose URL is a fragment (`#anchor`) that no heading in
 * the document provides. The slug set is built with `makeUniqueSlug`, so
 * duplicate headings get the same `-1`, `-2` suffixes the renderer gives them.
 *
 * Two things the heading text is NOT (audit 20260907 round 3):
 *   - raw inline HTML. `# Hello <b>World</b>` renders an anchor of
 *     `hello-world`; feeding the tags in produced `hello-bworldb`, so every
 *     link to that heading was reported missing (#810).
 *   - a URL-encoded spelling. `[x](#caf%C3%A9)` addresses `#café`, and
 *     comparing the raw URL text rejected it (#814).
 *
 * @module lib/lintEngine/rules/linkFragments
 */

import { visit } from "unist-util-visit";
import type { Root, Link, Heading, PhrasingContent } from "mdast";
import { createDiagnostic, type LintDiagnostic, type LintLineIndex } from "../types";
import { ruleEmission } from "../ruleMeta";
import { generateSlug, makeUniqueSlug } from "@/utils/headingSlug";
import { startOffset } from "./positionOffset";

/**
 * A heading's text as a reader sees it.
 *
 * `html` children are skipped: they are markup, not text, and the anchor the
 * renderer emits is built from the rendered text. Every other leaf with a
 * `value` — text, inlineCode — counts.
 */
function headingText(children: PhrasingContent[]): string {
  let text = "";
  for (const child of children) {
    if (child.type === "html") continue;
    if ("value" in child && typeof (child as { value?: unknown }).value === "string") {
      text += (child as { value: string }).value;
    } else if ("children" in child && Array.isArray((child as { children?: PhrasingContent[] }).children)) {
      text += headingText((child as { children: PhrasingContent[] }).children);
    }
  }
  return text;
}

/** The anchors this document offers, in the renderer's own numbering. */
function headingSlugs(mdast: Root): Set<string> {
  const slugs = new Set<string>();
  visit(mdast, "heading", (node: Heading) => {
    const base = generateSlug(headingText(node.children as PhrasingContent[]));
    if (!base) return;
    // One set for both jobs: `makeUniqueSlug` reads it to number a repeat, and
    // membership is what a link is checked against. Two sets were kept in
    // lockstep by hand and always held exactly the same values (#812).
    slugs.add(makeUniqueSlug(base, slugs));
  });
  return slugs;
}

/**
 * The fragment `url` addresses, decoded.
 *
 * A malformed encoding (`#100%`) makes `decodeURIComponent` throw; the raw text
 * is the honest answer there, not a crashed lint pass.
 */
function fragmentOf(url: string): string {
  const raw = url.slice(1);
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function linkFragments(
  _source: string,
  mdast: Root,
  { lineOffsets }: LintLineIndex,
): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const slugs = headingSlugs(mdast);

  visit(mdast, "link", (node: Link) => {
    if (!node.position) return;
    const url = node.url ?? "";
    if (!url.startsWith("#")) return;

    const fragment = fragmentOf(url);
    if (!fragment) return; // bare `#` — not a heading anchor
    if (slugs.has(fragment)) return;

    const { line, column } = node.position.start;
    diagnostics.push(
      createDiagnostic({
        ...ruleEmission("W04"),
        messageKey: "lint.W04",
        messageParams: { anchor: fragment },
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
