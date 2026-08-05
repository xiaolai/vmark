/**
 * Purpose: the declared-divergence ledger for the spec conformance gate.
 *
 * Every spec example where VMark's parse disagrees with the stock
 * `remark-parse` + `remark-gfm` reference must be covered by exactly one
 * entry here, with a verdict and a reason. The gate fails in both
 * directions: an undeclared divergence, and a declared example that no
 * longer diverges (stale entry) — the same ratchet discipline as
 * `referenceConformance.test.ts`.
 *
 * `extension` — VMark deliberately reads MORE (or different) structure
 *   because of a dialect extension (math, frontmatter, subscript, wiki
 *   links, details, …). Expected and healthy.
 * `defect` — the author wrote standard CommonMark/GFM and VMark corrupted
 *   or dropped it. Counted against `MAX_SPEC_DEFECTS`, which ratchets
 *   DOWN only.
 *
 * @coordinates-with specConformance.test.ts — the gate that consumes this
 * @module utils/markdownPipeline/__tests__/spec/specDeltas
 */

export interface SpecDelta {
  /** Example ids covered, e.g. "cm-93" (CommonMark) or "gfm-201" (GFM). */
  examples: readonly string[];
  verdict: "extension" | "defect";
  /** Why the divergence exists — a delta without one is a guess. */
  reason: string;
}

export const SPEC_DELTAS: readonly SpecDelta[] = [
  {
    // Every id in this list flips ONLY linkReference→link / imageReference→
    // image (triage-verified); the definition nodes stay in the tree on both
    // sides.
    examples: [
      "cm-23", "cm-33", "cm-192", "cm-193", "cm-194", "cm-195", "cm-196",
      "cm-198", "cm-200", "cm-202", "cm-203", "cm-204", "cm-205", "cm-206",
      "cm-214", "cm-215", "cm-216", "cm-217", "cm-218", "cm-527", "cm-528",
      "cm-529", "cm-530", "cm-531", "cm-532", "cm-533", "cm-534", "cm-535",
      "cm-539", "cm-540", "cm-541", "cm-542", "cm-543", "cm-544", "cm-549",
      "cm-550", "cm-553", "cm-554", "cm-555", "cm-556", "cm-557", "cm-558",
      "cm-559", "cm-560", "cm-561", "cm-562", "cm-564", "cm-565", "cm-566",
      "cm-568", "cm-569", "cm-570", "cm-571", "cm-573", "cm-576", "cm-577",
      "cm-582", "cm-583", "cm-584", "cm-585", "cm-586", "cm-587", "cm-588",
      "cm-589", "cm-591", "cm-593",
    ],
    verdict: "extension",
    reason:
      "resolveReferences: a reference-style link/image with a matching " +
      "definition is resolved to its inline link/image node so WYSIWYG can " +
      "edit it. Resolution is for editing, not storage — the definition node " +
      "is preserved and the serializer re-emits the reference form " +
      "(plugins/resolveReferences.ts).",
  },
  {
    examples: ["cm-548", "cm-590"],
    verdict: "extension",
    reason:
      "Wiki links: the `[[…]]` scanner claims doubled brackets " +
      "(`[[[foo]]]`, `![[foo]]`) that CommonMark reads as nested " +
      "bracket reference links. The inherent cost of the wiki-link dialect, " +
      "shared with Obsidian/Roam.",
  },
  {
    examples: ["cm-96", "cm-98"],
    verdict: "extension",
    reason:
      "Frontmatter: a document STARTING with `---` has its opening fence " +
      "read as YAML frontmatter, where CommonMark sees a thematic break or " +
      "setext underline. The classic reason frontmatter needs an explicit " +
      "extension — same call as 09-frontmatter.md in referenceConformance.",
  },
  {
    examples: ["vmark-frontmatter-yaml", "vmark-malformed-frontmatter"],
    verdict: "extension",
    reason: "remark-frontmatter reads the leading `---` fence as a `yaml` node.",
  },
  {
    examples: ["vmark-math-inline", "vmark-math-block"],
    verdict: "extension",
    reason: "remark-math reads `$…$` / `$$…$$` as inlineMath/math nodes.",
  },
  {
    examples: ["vmark-details-simple", "vmark-nesting-details-in-list"],
    verdict: "extension",
    reason:
      "remarkDetailsBlock folds the `<details>`/`<summary>` HTML pair into " +
      "one `details` node.",
  },
  {
    examples: ["vmark-toc-block"],
    verdict: "extension",
    reason: "remarkTocBlock converts a `[toc]` paragraph into a `toc` node.",
  },
  {
    examples: ["vmark-wiki-link"],
    verdict: "extension",
    reason: "Wiki links: `[[Target]]` becomes a `wikiLink` node.",
  },
  {
    examples: ["vmark-custom-inline-all"],
    verdict: "extension",
    reason:
      "Custom inline marks: `==` highlight, `~` subscript, `^` superscript, " +
      "`++` underline. The reference reads `~sub~` as GFM strikethrough " +
      "(its singleTilde default) and the rest as plain text.",
  },
  {
    examples: ["vmark-gfm-strikethrough"],
    verdict: "extension",
    reason:
      "THE tilde case: VMark sets `singleTilde: false` so `~x~` is subscript " +
      "and only `~~x~~` is deletion; stock remark-gfm reads `~x~` as delete.",
  },
  {
    examples: ["vmark-cm-bare-list-marker"],
    verdict: "extension",
    reason:
      "normalizeBareListMarkers: an indented lone `-` under text is a setext " +
      "underline to CommonMark; VMark repairs it to a bare list item so a " +
      "half-typed list does not collapse the paragraph into a heading.",
  },
];

/**
 * Ceiling on examples whose covering delta is a `defect`.
 * Ratchets DOWN only. Fix one, lower this number. Never raise it.
 */
export const MAX_SPEC_DEFECTS = 0;

/** The delta covering an example id, if any. */
export function coveringDelta(id: string): SpecDelta | undefined {
  return SPEC_DELTAS.find((d) => d.examples.includes(id));
}
