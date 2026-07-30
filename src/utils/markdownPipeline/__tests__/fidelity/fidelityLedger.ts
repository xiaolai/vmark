/**
 * The round-trip fidelity ledger.
 *
 * Purpose: record, per corpus document, every way the pipeline rewrites the
 * author's markdown — each with a named rule and a stated reason — and,
 * separately, every document whose MEANING it changes.
 *
 * This is the executable form of a distinction the characterization harness
 * states only in prose: "a golden records what the pipeline does, not what it
 * should do". A golden freezes the whole output, so once approved, a cosmetic
 * re-spelling and a corruption look identical in review. This ledger separates
 * them, and `docFingerprint` decides which is which mechanically rather than by
 * anyone's reading of a diff.
 *
 * The gate checks staleness in BOTH directions, matching the i18n and file-size
 * gates: an undeclared deviation fails, and a declared rule that no longer
 * fires also fails — so fixing something forces its entry to be removed instead
 * of rotting here as a false claim.
 *
 * @coordinates-with normalizationRules.ts — the rule predicates
 * @coordinates-with roundtripFidelity.test.ts — the gate
 * @module utils/markdownPipeline/__tests__/fidelity/fidelityLedger
 */
import type { RuleName } from "./normalizationRules";

export interface LedgerEntry {
  rule: RuleName;
  /** Why this rewrite of the user's file is intended. */
  reason: string;
}

/**
 * Corpus filename → the source rewrites reviewed and accepted for it.
 *
 * Absence means "this document must round-trip byte-identical". Ten of the
 * twenty-two corpus documents currently do.
 */
export const FIDELITY_LEDGER: Record<string, LedgerEntry[]> = {
  "02-lists.md": [
    {
      rule: "orderedListRenumbered",
      reason:
        "CommonMark takes an ordered list's start from its FIRST item and ignores every later ordinal; a blank line between items of one type makes a loose list, not a second list. The authored `7.` after `1. 2. 3.` is item four, so emitting `4.` is spec-correct. Fingerprint confirms no meaning change.",
    },
    {
      rule: "blankLineCollapse",
      reason: "Blank-line preservation is opt-in; runs between list blocks collapse.",
    },
  ],
  "03-code.md": [
    {
      rule: "codeSpanPaddingNormalized",
      reason:
        "CommonMark strips one padding space from each end of a code span whose content is space-delimited, so ``` `` a ` b `` ``` and ``` ``a ` b`` ``` denote the same span. Re-emitting without the padding is lossless.",
    },
  ],
  "04-tables.md": [
    {
      rule: "tableFormatting",
      reason:
        "Cells are re-padded to a common width and delimiter runs re-sized. Cell text and alignment colons are preserved; only whitespace changes.",
    },
  ],
  "05-blockquotes-alerts.md": [
    {
      rule: "alertQuoteContinuation",
      reason:
        "GitHub alerts are emitted with a bare `>` continuation line between the marker and the body, which is the canonical spelling and re-parses identically.",
    },
  ],
  "06-links-images.md": [
    {
      rule: "referenceLinkInlined",
      reason:
        "Reference-style links are re-emitted inline. The target and text are preserved (fingerprint confirms), but the authored reference STYLE is lost and its `[ref]:` definition is left behind unused. Accepted because the editor has no reference-link model; revisit if authors report it.",
    },
  ],
  "10-details.md": [
    { rule: "blankLineCollapse", reason: "Blank lines inside <details> collapse; preservation is opt-in." },
  ],
  "12-edge-cases.md": [
    {
      rule: "redundantEscapeDropped",
      reason:
        "`\\[not a link\\]` re-emits as `\\[not a link]`: with the opening bracket escaped there is no link to close, so the closing escape is unnecessary. Re-parses identically.",
    },
    { rule: "blankLineCollapse", reason: "Blank-line preservation is opt-in." },
  ],
  "15-video-embeds.md": [
    {
      rule: "providerEmbedRewrite",
      reason:
        "Deliberate privacy path: youtube.com becomes youtube-nocookie.com, and provider embeds gain default width/height. Documented in the characterization README as intended, not a defect.",
    },
  ],
  "17-escaped-markers.md": [
    {
      rule: "markerReEscaped",
      reason:
        "A highlight's closing `==` is re-emitted escaped when a literal `\\==` appears earlier on the line, so the two cannot re-pair ambiguously. Fingerprint confirms the highlight mark survives — the output is uglier than the input but denotes the same document.",
    },
  ],
  "18-nested-details.md": [
    { rule: "blankLineCollapse", reason: "Blank lines inside nested <details> collapse; preservation is opt-in." },
  ],
  "19-list-edge-cases.md": [
    { rule: "blankLineCollapse", reason: "Blank-line preservation is opt-in." },
  ],
  "21-alerts-rich.md": [
    { rule: "alertQuoteContinuation", reason: "Canonical `>` continuation spelling inside rich alerts." },
  ],
  "22-table-hardbreaks.md": [
    { rule: "tableFormatting", reason: "Cell re-padding only; cell text preserved." },
  ],
  "23-setext-headings.md": [
    {
      rule: "setextNormalisedToAtx",
      reason:
        "Setext headings are now READ as headings and re-emitted as ATX, which is VMark's single heading spelling. Previously they were destroyed at parse time — a paragraph with an escaped `\\=====`, or a paragraph plus a thematic break — and this entry recorded that damage. The remaining deviation is a spelling change with no loss of structure.",
    },
  ],
};

/**
 * Documents whose round-trip changes the PARSED document, not just its
 * spelling — real corruption, derived by `docFingerprint` rather than judged by
 * eye. An entry is an admission, never an approval: it keeps the gate
 * actionable while the defect is outstanding.
 *
 * Corpus filename → what is destroyed, and why it is still here.
 *
 * Currently EMPTY, and that is a real result: all twenty-three corpus
 * documents re-parse to exactly the document they started as. Every deviation
 * catalogued above is spelling, not meaning.
 *
 * Note the blind spot this map has by construction — it compares VMark's parse
 * of the input against VMark's parse of the output, so it cannot see a
 * construct the PARSER drops: both sides are then equally damaged and the
 * round-trip looks stable. That class is owned by
 * `referenceConformance.test.ts`, which measures against stock remark instead.
 * The setext defect lives there for exactly this reason.
 */
export const SEMANTIC_DEFECTS: Record<string, string> = {};

/**
 * Ceiling on declared semantic defects.
 *
 * Ratchets DOWN only. Never raise it — a new entry means the serializer
 * regressed, which is what this gate is for. The parser's own defect ceiling is
 * `MAX_CONFORMANCE_DEFECTS` in referenceConformance.test.ts.
 */
export const MAX_KNOWN_DEFECTS = 0;
