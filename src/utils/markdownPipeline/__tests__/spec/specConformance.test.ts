/**
 * WI-0.1/WI-0.2 — the spec parse-conformance gate, exhaustive by enumeration.
 *
 * Every example of the vendored CommonMark 0.31.2 spec, the GFM extension
 * sections, and the VMark dialect manifest is parsed by VMark's document
 * pipeline AND by a stock `remark-parse` + `remark-gfm` reference, both
 * projected to semantic form, and deep-diffed. The hand-written corpora are
 * representative-by-construction; this gate is exhaustive-by-enumeration — a
 * spec corner nobody thought to hand-write still has an example here.
 *
 * Divergence handling is EXACT-SIGNATURE (ADR-1): a declaration in
 * `specDeltas.json` pins path, kind, detail and both observed values, so a
 * future DIFFERENT divergence on a declared example still fails. The gate
 * fails in both directions — undeclared divergence, and declared entry that
 * no longer matches anything (stale). Verdict `defect` marks corruption of
 * standard input; `extension` marks deliberate dialect structure. Identity
 * ratcheting across commits is the merge-base gate's job (ADR-5), not a
 * numeric ceiling here.
 *
 * @coordinates-with corpusRegistry.ts — the only corpus source
 * @coordinates-with specLedgers.ts — declaration shape + matching
 * @coordinates-with ../../conformance/semanticProjection.ts — what is compared
 * @module utils/markdownPipeline/__tests__/spec/specConformance.test
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import "../../dialect";
import { createProcessor } from "../../parser/processorFactory";
import {
  project,
  diff,
  type Divergence,
  type RawNode,
} from "../../conformance/semanticProjection";
import { examplesForRoute, type SpecExample } from "./corpusRegistry";
import {
  loadConformanceLedger,
  conformanceMatches,
  reasonsAreStated,
} from "./specLedgers";

const EXAMPLES = examplesForRoute("conformance");
const LEDGER = loadConformanceLedger();

function vmarkParse(markdown: string): RawNode {
  const processor = createProcessor(markdown);
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

function referenceParse(markdown: string): RawNode {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

/** Divergences per example, computed once — staleness checks reuse them. */
const divergenceCache = new Map<string, Divergence[]>();
function divergencesFor(example: SpecExample): Divergence[] {
  const cached = divergenceCache.get(example.id);
  if (cached) return cached;
  const out = diff(
    project(vmarkParse(example.markdown)),
    project(referenceParse(example.markdown)),
  );
  divergenceCache.set(example.id, out);
  return out;
}

describe("spec corpus shape", () => {
  it("enumerates the pinned example counts (additions are deliberate)", () => {
    const byPrefix = new Map<string, number>();
    for (const e of EXAMPLES) {
      const prefix = e.id.slice(0, e.id.indexOf("-"));
      byPrefix.set(prefix, (byPrefix.get(prefix) ?? 0) + 1);
    }
    expect(byPrefix.get("cm")).toBe(652);
    expect(byPrefix.get("gfm")).toBe(24);
    expect(byPrefix.get("vmark")).toBeGreaterThan(0);
  });
});

describe("VMark's parse agrees with the stock reference except where declared", () => {
  it.each(EXAMPLES)("$id ($section)", (example) => {
    const undeclared = divergencesFor(example).filter(
      (d) => !LEDGER.some((delta) => conformanceMatches(delta, d, example.id)),
    );
    expect(
      undeclared.map(
        (d) =>
          `${example.id} ${d.path} ${d.kind} ${d.detail} ` +
          `vmark=${JSON.stringify(d.documentValue)} ref=${JSON.stringify(d.sourcePositionValue)}`,
      ),
    ).toEqual([]);
  });
});

describe("the ledger cannot rot into a suppression file", () => {
  it("every declared delta matches a real divergence (stale entries fail)", () => {
    const examplesById = new Map(EXAMPLES.map((e) => [e.id, e]));
    const stale = LEDGER.filter((delta) => {
      const example = examplesById.get(delta.exampleId);
      if (!example) return true;
      return !divergencesFor(example).some((d) =>
        conformanceMatches(delta, d, delta.exampleId),
      );
    });
    expect(
      stale.map((d) => `${d.exampleId} ${d.path} ${d.kind} ${d.detail}`),
    ).toEqual([]);
  });

  it("every declared delta carries a stated reason", () => {
    expect(reasonsAreStated(LEDGER)).toEqual([]);
  });
});

describe("the gate is not vacuous", () => {
  it("a deliberately-wrong signature would NOT be covered", () => {
    // Take any declared delta, flip its detail, and prove the gate would
    // treat the mutated form as undeclared — the DoD probe for ADR-1.
    const delta = LEDGER[0];
    expect(delta).toBeDefined();
    const example = EXAMPLES.find((e) => e.id === delta.exampleId)!;
    const real = divergencesFor(example).find((d) =>
      conformanceMatches(delta, d, example.id),
    )!;
    expect(real).toBeDefined();
    const mutated: Divergence = { ...real, detail: `${real.detail} (mutated)` };
    expect(
      LEDGER.some((l) => conformanceMatches(l, mutated, example.id)),
    ).toBe(false);
  });
});
