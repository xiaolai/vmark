/**
 * Markdown pipeline — spec ROUND-TRIP gate (exhaustive by enumeration).
 *
 * The serializer half of `specConformance.test.ts`: every CommonMark 0.31.2
 * example, every GFM extension example and every VMark dialect fixture is
 * round-tripped through the production pipeline
 * (`markdown → ProseMirror doc → markdown`) and held to two invariants:
 *
 *   1. STABILITY — the first pass may normalize, but it must be a fixed
 *      point: `roundtrip(once) === once`. An oscillation is always a real
 *      serializer bug (the #1102 asterisk-growth / entity-injection class).
 *   2. FIDELITY — VMark's own reading must survive: `mdast(input)` vs
 *      `mdast(once)`, compared with the semantic projection. What the
 *      parser saw before the round trip, it must still see after.
 *
 * Divergences must be DECLARED in `specRoundtripDeltas.ts` with a verdict
 * and a reason; stale declarations fail; `defect` counts ratchet DOWN only.
 * A crash is never declarable — any throw fails the gate outright.
 *
 * @coordinates-with corpus/*.json — the vendored spec examples (see README.md)
 * @coordinates-with specRoundtripDeltas.ts — the declared-divergence ledger
 * @coordinates-with specConformance.test.ts — the parse-conformance half
 * @coordinates-with ../fidelity/roundtripFidelity.test.ts — corpus-level sibling
 * @module utils/markdownPipeline/__tests__/spec/specRoundtrip.test
 */
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { parseMarkdownToMdast } from "../../parser";
import {
  project,
  type RawNode,
} from "../../conformance/semanticProjection";
import {
  diff,
  type Divergence,
} from "../../conformance/projectionDiff";
import { getProductionSchema } from "@/test/productionSchema";
import {
  STABILITY_DELTAS,
  FIDELITY_DELTAS,
  MAX_STABILITY_DEFECTS,
  MAX_FIDELITY_DEFECTS,
  coveringStabilityDelta,
  coveringFidelityDelta,
} from "./specRoundtripDeltas";
import { ALL_EXAMPLES, malformedExampleIds } from "@/test/markdownSpecCorpus";
import {
  compareFingerprints,
  describeFingerprints,
  type FingerprintMap,
} from "@/test/specFingerprints";
import ROUNDTRIP_FINGERPRINTS from "./fingerprints/roundtrip.json";

const schema = getProductionSchema();
const roundtrip = (md: string): string =>
  serializeMarkdown(schema, parseMarkdown(schema, md));

function fidelityDiff(input: string, once: string): Divergence[] {
  return diff(
    project(parseMarkdownToMdast(input) as unknown as RawNode),
    project(parseMarkdownToMdast(once) as unknown as RawNode),
    "root",
    { pinAttributesAcrossTypes: true },
  );
}

function describeDivergences(divs: Divergence[]): string {
  return divs
    .slice(0, 5)
    .map(
      (d) =>
        `    ${d.path} [${d.kind}] ${d.detail}` +
        ` (before=${JSON.stringify(d.documentValue)}` +
        ` after=${JSON.stringify(d.sourcePositionValue)})`,
    )
    .join("\n");
}

describe("the round-trip corpus is intact", () => {
  it("has no malformed example record", () => {
    // Shared with specConformance via specCorpus.ts — one loader, so
    // validation cannot protect one gate and miss the other.
    expect(malformedExampleIds()).toEqual([]);
  });
});

describe("the round-trip deltas ledger is well-formed", () => {
  const knownIds = new Set(ALL_EXAMPLES.map((e) => e.id));

  it("declares only example ids that exist in a corpus", () => {
    const unknown = [
      ...STABILITY_DELTAS.flatMap((d) => d.examples),
      ...FIDELITY_DELTAS.flatMap((d) => d.examples),
    ].filter((id) => !knownIds.has(id));
    expect(unknown).toEqual([]);
  });

  it("covers every example by at most one delta per invariant", () => {
    for (const deltas of [STABILITY_DELTAS, FIDELITY_DELTAS] as const) {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const d of deltas) {
        for (const id of d.examples) {
          if (seen.has(id)) dupes.push(id);
          seen.add(id);
        }
      }
      expect(dupes).toEqual([]);
    }
  });

  // EQUALITY, not `<=`. Slack is how a ratchet stops ratcheting: with a
  // ceiling above the real count, a future defect can be declared without
  // anyone raising a number, and the gate stays green through a regression.
  it("keeps the fingerprint file in step with the ledger", () => {
    const declared = new Set(FIDELITY_DELTAS.flatMap((d) => d.examples));
    const pinned = new Set(Object.keys(ROUNDTRIP_FINGERPRINTS as FingerprintMap));
    expect([...pinned].filter((id) => !declared.has(id))).toEqual([]);
    expect([...declared].filter((id) => !pinned.has(id))).toEqual([]);
  });

  it("pins the stability-defect count exactly at its ratchet", () => {
    const count = STABILITY_DELTAS.flatMap((d) => d.examples).length;
    expect(
      count === MAX_STABILITY_DEFECTS
        ? ""
        : `\n  ${count} unstable examples declared but the ceiling is ` +
          `${MAX_STABILITY_DEFECTS}. Fix one and LOWER the ceiling to match;` +
          ` never raise it.\n`,
    ).toBe("");
  });

  it("pins the fidelity-defect count exactly at its ratchet", () => {
    const defects = FIDELITY_DELTAS.filter((d) => d.verdict === "defect")
      .flatMap((d) => d.examples);
    expect(
      defects.length === MAX_FIDELITY_DEFECTS
        ? ""
        : `\n  ${defects.length} fidelity defects declared but the ceiling is ` +
          `${MAX_FIDELITY_DEFECTS}.\n  ${defects.join(", ")}\n` +
          `  Fix one and LOWER the ceiling to match; never raise it.\n`,
    ).toBe("");
  });
});

describe("spec round-trip: stability and fidelity", () => {
  for (const example of ALL_EXAMPLES) {
    it(`${example.id} (${example.section})`, () => {
      let once = "";
      let twice = "";
      try {
        once = roundtrip(example.markdown);
        twice = roundtrip(once);
      } catch (err) {
        expect.fail(
          `\n  ${example.id}: the round trip THREW — never declarable.\n` +
            `  input: ${JSON.stringify(example.markdown)}\n` +
            `  error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }

      const unstable = twice !== once;
      const stabilityDeclared = coveringStabilityDelta(example.id);
      if (unstable && !stabilityDeclared) {
        expect.fail(
          `\n  ${example.id} (${example.section}): the round trip OSCILLATES —` +
            ` the second pass changed the first pass's output.\n` +
            `  input: ${JSON.stringify(example.markdown)}\n` +
            `  once:  ${JSON.stringify(once)}\n` +
            `  twice: ${JSON.stringify(twice)}\n` +
            `  This is a real serializer bug. If it cannot be fixed now,\n` +
            `  declare it in specRoundtripDeltas.ts (STABILITY_DELTAS).\n`,
        );
      }
      if (!unstable && stabilityDeclared) {
        expect.fail(
          `\n  ${example.id}: declared unstable in STABILITY_DELTAS but the` +
            ` round trip is now a fixed point. Delete the id and lower` +
            ` MAX_STABILITY_DEFECTS.\n`,
        );
      }

      const divs = fidelityDiff(example.markdown, once);
      const fidelityDeclared = coveringFidelityDelta(example.id);
      if (divs.length > 0 && !fidelityDeclared) {
        expect.fail(
          `\n  ${example.id} (${example.section}): the round trip changed what` +
            ` VMark's parser sees.\n` +
            `  input: ${JSON.stringify(example.markdown)}\n` +
            `  once:  ${JSON.stringify(once)}\n` +
            `${describeDivergences(divs)}\n` +
            `  Declare it in specRoundtripDeltas.ts (FIDELITY_DELTAS) with the` +
            ` right verdict, or fix the serializer.\n`,
        );
      }
      if (divs.length > 0 && fidelityDeclared) {
        const { unexpected, missing } = compareFingerprints(
          divs,
          (ROUNDTRIP_FINGERPRINTS as FingerprintMap)[example.id] ?? [],
        );
        if (unexpected.length > 0 || missing.length > 0) {
          expect.fail(
            `\n  ${example.id}: round-trip divergences changed on a DECLARED` +
              ` example.\n` +
              (unexpected.length
                ? `  new (not pinned):\n${describeFingerprints(unexpected)}\n`
                : "") +
              (missing.length
                ? `  gone (pinned but absent):\n${describeFingerprints(missing)}\n`
                : "") +
              `  Review, then regenerate fingerprints/roundtrip.json.\n`,
          );
        }
      }
      if (divs.length === 0 && fidelityDeclared) {
        expect.fail(
          `\n  ${example.id}: a fidelity divergence is declared but the round` +
            ` trip now preserves the parse. Delete the id from its entry` +
            ` (and lower MAX_FIDELITY_DEFECTS if it was a defect).\n`,
        );
      }
    });
  }
});
