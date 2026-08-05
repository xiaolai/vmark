/**
 * Purpose: the declared-divergence ledger for the spec ROUND-TRIP gate.
 *
 * Two invariants, two ledgers:
 *
 * STABILITY — `serialize∘parse` must be a fixed point after the first
 *   normalizing pass: `roundtrip(roundtrip(x)) === roundtrip(x)`. There is no
 *   legitimate reason to oscillate, so every entry is a `defect` and the
 *   ceiling ratchets DOWN only.
 *
 * FIDELITY — what VMark's own parser sees must survive the round trip:
 *   `mdast(x)` vs `mdast(roundtrip(x))`, compared with the semantic
 *   projection. Divergences carry one of four verdicts:
 *
 * `defect` — fixable serializer/converter bug; real corruption. Counted
 *   against `MAX_FIDELITY_DEFECTS`, ratchets DOWN only.
 * `model-limit` — the ProseMirror document model cannot represent the
 *   construct (marks are an unordered set on text; no list looseness; no
 *   code-fence meta), so the loss is structural until the schema grows.
 *   Honest data loss, permanently documented — NOT counted as a defect,
 *   but pinned so the set cannot grow silently.
 * `normalization` — the markdown changes but the RENDERED document does
 *   not (soft break ↔ space, marks reopened around a hard break, table
 *   rows padded). Deliberate or benign.
 * (A `policy` verdict used to exist for URLs rewritten to `about:blank` by
 * `isSafeUrl`. That rewrite was removed — it corrupted the author's file on
 * save — so the category has no members and is gone. Containment now lives
 * at the render/activation sinks; see `linkSecurity.test.ts`.)
 *
 * The gate fails in both directions: an undeclared divergence, and a
 * declared example that no longer diverges (stale entry).
 *
 * @coordinates-with specRoundtrip.test.ts — the gate that consumes this
 * @coordinates-with specDeltas.ts — the parse-conformance sibling ledger
 * @module utils/markdownPipeline/__tests__/spec/specRoundtripDeltas
 */

type FidelityVerdict = "defect" | "model-limit" | "normalization";

export interface StabilityDelta {
  examples: readonly string[];
  /** Why the second pass differs from the first — always a real bug. */
  reason: string;
}

export interface FidelityDelta {
  examples: readonly string[];
  verdict: FidelityVerdict;
  reason: string;
}

export const STABILITY_DELTAS: readonly StabilityDelta[] = [
  // Empty, and the gate keeps it that way. The two families this ledger
  // opened with — the leading-`---` frontmatter trap (cm-43/47) and
  // bracket-escape growth (cm-194/512/549/550) — were fixed in
  // serializer.ts, serializerHandlers.ts and resolveReferences.ts;
  // roundtripDefects.test.ts D5/D6 pin the fixes.
];

export const FIDELITY_DELTAS: readonly FidelityDelta[] = [
  {
    examples: ["cm-39"],
    verdict: "defect",
    reason:
      "`&#10;&#10;` (entity-encoded newlines) is serialized as literal " +
      "newlines, which reparse as a paragraph break — one paragraph " +
      "becomes two. The serializer must re-encode control characters.",
  },
  {
    examples: [
      "cm-369", "cm-373", "cm-389", "cm-407", "cm-408", "cm-409", "cm-417",
      "cm-418", "cm-419", "cm-425", "cm-426", "cm-427", "cm-432", "cm-433",
      "cm-461", "cm-463", "cm-464", "cm-465", "cm-466", "cm-468",
    ],
    verdict: "model-limit",
    reason:
      "ProseMirror marks are an unordered SET on text: same-type nesting " +
      "(`*(*foo*)*`, `****foo****`) collapses to one mark, `*_foo_*` " +
      "collapses because both spellings map to the same em mark, and mark " +
      "order around links (`**[*bar*](/url)**`) is not representable.",
  },
  {
    examples: [
      "cm-109", "cm-300", "cm-306", "cm-311", "cm-313", "cm-314", "cm-315",
      "cm-316", "cm-317", "cm-320", "cm-321", "cm-326",
    ],
    verdict: "model-limit",
    reason:
      "List looseness (`spread`) is not stored in the ProseMirror schema; " +
      "pmBlockConverters derives it structurally (multi-block item = " +
      "spread), so a loose list of single-paragraph items serializes tight " +
      "and vice versa. Rendering changes paragraph margins only.",
  },
  {
    examples: ["cm-484", "cm-487"],
    verdict: "model-limit",
    reason:
      "An empty-text link (`[](/uri)`) vanishes entirely: a link is a mark " +
      "and a mark needs text to exist on. The harshest loss in this ledger " +
      "— the construct is deleted from the file on save.",
  },
  {
    examples: ["cm-517", "cm-531"],
    verdict: "model-limit",
    reason:
      "A link wrapping an image (`[![moon](moon.jpg)](/uri)`) loses the " +
      "link: image is a node, link is a text mark, and the schema has no " +
      "way to put the mark on the node. The hyperlink is lost on save.",
  },
  {
    examples: ["cm-143", "cm-146"],
    verdict: "model-limit",
    reason:
      "The code-fence info string beyond the language (`meta`) is not an " +
      "attribute of the ProseMirror code block, so it is dropped.",
  },
  {
    examples: ["cm-148", "cm-187"],
    verdict: "normalization",
    reason:
      "A soft line break inside a paragraph with inline HTML serializes as " +
      "a space. Soft break and space render identically.",
  },
  {
    examples: ["cm-638", "cm-639"],
    verdict: "normalization",
    reason:
      "Emphasis spanning a hard break is closed and reopened around it " +
      "(`*foo*\\` / `*bar*`). Both lines still render emphasized.",
  },
  {
    examples: ["gfm-202", "gfm-204"],
    verdict: "normalization",
    reason:
      "Ragged table rows are padded to a uniform column count (GFM renders " +
      "missing cells empty anyway; gfm-204 gains a visible empty column " +
      "because one row was wider than the header).",
  },
  {
    examples: ["vmark-alert-note"],
    verdict: "normalization",
    reason:
      "Alert blocks gain an internal blank `>` line between marker and " +
      "body (documented in the characterization goldens); the alert " +
      "renders identically.",
  },
];

/** Ceilings. Ratchet DOWN only. Fix one, lower the number. Never raise. */
export const MAX_STABILITY_DEFECTS = 0;
export const MAX_FIDELITY_DEFECTS = 1;

export function coveringStabilityDelta(id: string): StabilityDelta | undefined {
  return STABILITY_DELTAS.find((d) => d.examples.includes(id));
}

export function coveringFidelityDelta(id: string): FidelityDelta | undefined {
  return FIDELITY_DELTAS.find((d) => d.examples.includes(id));
}
