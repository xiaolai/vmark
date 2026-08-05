/**
 * Markdown pipeline — spec conformance gate (exhaustive by enumeration).
 *
 * Purpose: run EVERY example of the official CommonMark 0.31.2 spec plus the
 * GFM extension sections (tables, task lists, strikethrough, autolinks,
 * disallowed raw HTML) through VMark's parser, and compare the resulting
 * mdast DEEPLY against a stock `remark-parse` + `remark-gfm` reference.
 *
 * `referenceConformance.test.ts` does this comparison for the hand-written
 * characterization corpus, at top-level block shape. This gate closes the two
 * gaps that leaves open:
 *   1. Coverage: the corpus is representative-by-construction; a spec corner
 *      nobody thought to hand-write has no fixture. The spec's own example
 *      enumeration is the exhaustive list of corners.
 *   2. Depth: block shape cannot see inline-level disagreement (emphasis
 *      precedence, tilde semantics, autolink boundaries). The comparison here
 *      is the full semantic projection from `conformance/semanticProjection`.
 *
 * A divergence is not automatically a bug — VMark deliberately extends
 * markdown (math `$`, frontmatter, `~sub~`, wiki links, details, TOC …) and
 * some spec inputs contain those trigger characters. So every divergence must
 * be DECLARED in `specDeltas.ts` with a verdict and a reason, a declaration
 * that stops firing fails, and the `defect` count ratchets DOWN only.
 *
 * A third corpus section runs the `conformance/fixtures.ts` manifest (VMark's
 * own dialect constructs) through the same ruler, so every extension's
 * divergence from stock GFM is itself pinned: an extension that silently
 * stops firing makes its declared delta stale, which fails.
 *
 * @coordinates-with corpus/*.json — the vendored spec examples (see README.md)
 * @coordinates-with specDeltas.ts — the declared-divergence ledger
 * @coordinates-with ../../conformance/semanticProjection.ts — the ruler
 * @coordinates-with ../fidelity/referenceConformance.test.ts — corpus-level sibling
 * @module utils/markdownPipeline/__tests__/spec/specConformance.test
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseMarkdownToMdast } from "../../parser";
import {
  project,
  type RawNode,
} from "../../conformance/semanticProjection";
import {
  diff,
  type Divergence,
} from "../../conformance/projectionDiff";
import { SPEC_DELTAS, MAX_SPEC_DEFECTS, coveringDelta } from "./specDeltas";
import {
  compareFingerprints,
  describeFingerprints,
  type FingerprintMap,
} from "@/test/specFingerprints";
import PARSE_FINGERPRINTS from "./fingerprints/parse.json";
import {
  COMMONMARK,
  GFM,
  VMARK_FIXTURES,
  ALL_EXAMPLES,
  EXPECTED_COMMONMARK_COUNT,
  EXPECTED_GFM_COUNT,
  malformedExampleIds,
} from "@/test/markdownSpecCorpus";

// The stock CommonMark/GFM ruler — none of VMark's plugins.
const reference = unified().use(remarkParse).use(remarkGfm);

function referenceParse(markdown: string): RawNode {
  return reference.runSync(reference.parse(markdown)) as unknown as RawNode;
}

function divergencesOf(markdown: string): Divergence[] {
  return diff(
    project(referenceParse(markdown)),
    project(parseMarkdownToMdast(markdown) as unknown as RawNode),
    "root",
    // Pin attributes across a declared type flip — otherwise a changed
    // resolved URL inside a declared divergence stays invisible.
    { pinAttributesAcrossTypes: true },
  );
}

function describeDivergences(divs: Divergence[]): string {
  return divs
    .slice(0, 5)
    .map(
      (d) =>
        `    ${d.path} [${d.kind}] ${d.detail}` +
        ` (reference=${JSON.stringify(d.documentValue)}` +
        ` vmark=${JSON.stringify(d.sourcePositionValue)})`,
    )
    .join("\n");
}

describe("spec conformance corpus", () => {
  it("loads the full CommonMark 0.31.2 enumeration", () => {
    expect(COMMONMARK.length).toBe(EXPECTED_COMMONMARK_COUNT);
  });

  it("loads the GFM extension examples", () => {
    // Exact: a lower bound lets vendored cases disappear silently.
    expect(GFM.length).toBe(EXPECTED_GFM_COUNT);
  });

  it("gives every example a unique id", () => {
    const ids = ALL_EXAMPLES.map((e) => e.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("gives every example a usable section and markdown body", () => {
    // Shape validation, not just counts: a truncated or malformed corpus
    // entry would otherwise sail through as a silently-skipped case.
    expect(malformedExampleIds()).toEqual([]);
  });
});

describe("the deltas ledger is well-formed", () => {
  const knownIds = new Set(ALL_EXAMPLES.map((e) => e.id));

  it("declares only example ids that exist in a corpus", () => {
    const unknown = SPEC_DELTAS.flatMap((d) =>
      d.examples.filter((id) => !knownIds.has(id)),
    );
    expect(unknown).toEqual([]);
  });

  it("covers every example by at most one delta", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const d of SPEC_DELTAS) {
      for (const id of d.examples) {
        if (seen.has(id)) dupes.push(id);
        seen.add(id);
      }
    }
    expect(dupes).toEqual([]);
  });

  it("keeps the fingerprint file in step with the ledger", () => {
    // A stale key is silently ignored at lookup time, so an example whose
    // ledger entry was deleted would leave dead pins behind — and a declared
    // example with no pins would be back to a blanket licence.
    const declared = new Set(SPEC_DELTAS.flatMap((d) => d.examples));
    const pinned = new Set(Object.keys(PARSE_FINGERPRINTS as FingerprintMap));
    expect([...pinned].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !pinned.has(id))).toEqual([]);
  });

  it("declares no delta with an empty example list or a blank reason", () => {
    const malformed = SPEC_DELTAS.filter(
      (d) => d.examples.length === 0 || d.reason.trim() === "",
    ).map((d) => d.examples.join(",") || "(empty)");
    expect(malformed).toEqual([]);
  });

  it("holds the spec-defect count at or below its ratchet", () => {
    const defects = SPEC_DELTAS.filter((d) => d.verdict === "defect").flatMap(
      (d) => d.examples,
    );
    expect(
      defects.length <= MAX_SPEC_DEFECTS
        ? ""
        : `\n  ${defects.length} spec defects declared but the ceiling is ${MAX_SPEC_DEFECTS}.\n` +
          `  ${defects.join(", ")}\n  This gate ratchets DOWN only — never raise the ceiling.\n`,
    ).toBe("");
  });
});

for (const [name, corpus] of [
  ["CommonMark 0.31.2", COMMONMARK],
  ["GFM extensions", GFM],
  ["VMark dialect fixtures", VMARK_FIXTURES],
] as const) {
  describe(`${name}: VMark agrees with remark-parse + remark-gfm`, () => {
    for (const example of corpus) {
      it(`${example.id} (${example.section})`, () => {
        const divs = divergencesOf(example.markdown);
        const declared = coveringDelta(example.id);

        if (divs.length > 0 && !declared) {
          expect.fail(
            `\n  ${example.id} (${example.section}): VMark's parse diverges from the` +
              ` CommonMark/GFM reference and no delta covers it.\n` +
              `  input: ${JSON.stringify(example.markdown)}\n` +
              `${describeDivergences(divs)}\n` +
              `  If intended (a VMark extension), declare it in specDeltas.ts.\n`,
          );
        }
        if (divs.length > 0 && declared) {
          // A declared example is NOT a blanket licence: the exact set of
          // divergences is pinned, so NEW corruption on an already-declared
          // example fails instead of hiding behind the declaration.
          const { unexpected, missing } = compareFingerprints(
            divs,
            (PARSE_FINGERPRINTS as FingerprintMap)[example.id] ?? [],
          );
          if (unexpected.length > 0 || missing.length > 0) {
            expect.fail(
              `\n  ${example.id}: the divergences changed on a DECLARED example.\n` +
                (unexpected.length
                  ? `  new (not pinned):\n${describeFingerprints(unexpected)}\n`
                  : "") +
                (missing.length
                  ? `  gone (pinned but absent):\n${describeFingerprints(missing)}\n`
                  : "") +
                `  Review the change, then regenerate fingerprints/parse.json.\n`,
            );
          }
        }
        if (divs.length === 0 && declared) {
          expect.fail(
            `\n  ${example.id}: a divergence is declared in specDeltas.ts but the` +
              ` parses now agree. Delete the id from that entry.\n`,
          );
        }
      });
    }
  });
}
