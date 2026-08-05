/**
 * WI-0.1/WI-0.2 — the spec round-trip gate: every corpus example through
 * markdown → ProseMirror → markdown, held to two invariants.
 *
 * STABILITY: the second pass must not change the first pass's output. The
 * first pass may normalize; an oscillation after it is always a real
 * serializer bug. A declared oscillation pins the sha256 of BOTH passes, so
 * any change to either output makes the entry stale and forces re-triage.
 *
 * FIDELITY: VMark's own parse of the output must match its parse of the
 * input, by semantic projection — data loss and corruption surface here.
 * Declarations are exact-signature (ADR-1) with a verdict: `defect` (fixable
 * corruption), `model-limit` (the ProseMirror model cannot represent the
 * construct — honest, pinned data loss), `normalization` (markdown changes,
 * rendered document does not), `policy` (deliberate rewriting, e.g. URL
 * sanitization).
 *
 * A crash in parse or serialize is NEVER declarable — it propagates and
 * fails the example outright.
 *
 * @coordinates-with corpusRegistry.ts — the only corpus source
 * @coordinates-with specLedgers.ts — declaration shapes + matching
 * @coordinates-with specConformance.test.ts — the parse-side gate
 * @module utils/markdownPipeline/__tests__/spec/specRoundtrip.test
 */
import { describe, it, expect } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import "../../dialect";
import { createProcessor } from "../../parser/processorFactory";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";
import {
  project,
  type RawNode,
} from "../../conformance/semanticProjection";
import {
  diff,
  type Divergence,
} from "../../conformance/projectionDiff";
import {
  CORPORA,
  examplesForRoute,
  loadExamples,
  sha256Of,
  type SpecExample,
  type VendoredCorpus,
} from "./corpusRegistry";
import {
  loadRoundtripLedger,
  fidelityMatches,
  reasonsAreStated,
} from "./specLedgers";

const EXAMPLES = examplesForRoute("roundtrip");
const LEDGER = loadRoundtripLedger();
const schema = getProductionSchema();

function mdastOf(markdown: string): RawNode {
  const processor = createProcessor(markdown);
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

function referenceMdastOf(markdown: string): RawNode {
  const processor = unified().use(remarkParse).use(remarkGfm);
  return processor.runSync(processor.parse(markdown)) as unknown as RawNode;
}

interface RoundtripResult {
  pass1: string;
  pass2: string;
  fidelityDivergences: Divergence[];
  /** WI-2.2 (ADR-4): STOCK REMARK parses input and output — an independent
   *  ruler. The `fidelity` leg parses both sides with VMark's own parser, so
   *  a defect shared by parser AND serializer is invisible to it; this leg
   *  does not share those blind spots. */
  independentRulerDivergences: Divergence[];
}

const cache = new Map<string, RoundtripResult>();
function roundtripOf(example: SpecExample): RoundtripResult {
  const cached = cache.get(example.id);
  if (cached) return cached;
  const pass1 = serializeMarkdown(schema, parseMarkdown(schema, example.markdown));
  const pass2 = serializeMarkdown(schema, parseMarkdown(schema, pass1));
  const fidelityDivergences = diff(
    project(mdastOf(example.markdown)),
    project(mdastOf(pass1)),
  );
  const independentRulerDivergences = diff(
    project(referenceMdastOf(example.markdown)),
    project(referenceMdastOf(pass1)),
  );
  const out = { pass1, pass2, fidelityDivergences, independentRulerDivergences };
  cache.set(example.id, out);
  return out;
}

describe("dialect corpora actually produce their dialect nodes (no self-oracle)", () => {
  // A roundtrip-only dialect corpus whose examples all parsed as plain text
  // would trivially roundtrip and prove nothing. The registry pins how many
  // examples contain the dialect node; both directions of drift fail.
  const contains = (node: RawNode, type: string): boolean =>
    node.type === type || (node.children ?? []).some((c) => contains(c, type));

  const contracted = CORPORA.filter(
    (c): c is VendoredCorpus => c.kind === "vendored-json" && c.mustProduce !== undefined,
  );

  it("every roundtrip-only corpus carries a mustProduce contract", () => {
    const bare = CORPORA.filter(
      (c) =>
        c.kind === "vendored-json" &&
        !c.routes.conformance &&
        c.routes.roundtrip &&
        c.mustProduce === undefined,
    );
    expect(bare.map((c) => (c as VendoredCorpus).file)).toEqual([]);
  });

  it.each(contracted)("$file: pinned count of examples producing the dialect node", (entry) => {
    const { nodeType, exampleCount } = entry.mustProduce!;
    const count = loadExamples(entry).filter((e) =>
      contains(mdastOf(e.markdown), nodeType),
    ).length;
    expect(count, `${entry.file} examples containing ${nodeType}`).toBe(exampleCount);
    expect(count).toBeGreaterThan(0);
  });
});

describe("stability: serialize∘parse is a fixed point after one pass", () => {
  it.each(EXAMPLES)("$id ($section)", (example) => {
    const { pass1, pass2 } = roundtripOf(example);
    if (pass2 === pass1) return;
    const declared = LEDGER.stability.find(
      (d) =>
        d.exampleId === example.id &&
        d.pass1Sha256 === sha256Of(pass1) &&
        d.pass2Sha256 === sha256Of(pass2),
    );
    expect(
      declared,
      `${example.id} oscillates and no declaration pins these exact outputs:\n` +
        `pass1: ${JSON.stringify(pass1)}\npass2: ${JSON.stringify(pass2)}`,
    ).toBeDefined();
  });
});

describe("fidelity: VMark reads the output as it read the input, except where declared", () => {
  it.each(EXAMPLES)("$id ($section)", (example) => {
    const undeclared = roundtripOf(example).fidelityDivergences.filter(
      (d) => !LEDGER.fidelity.some((delta) => fidelityMatches(delta, d, example.id)),
    );
    expect(
      undeclared.map(
        (d) =>
          `${example.id} ${d.path} ${d.kind} ${d.detail} ` +
          `input=${JSON.stringify(d.documentValue)} output=${JSON.stringify(d.sourcePositionValue)}`,
      ),
    ).toEqual([]);
  });
});

describe("independent ruler: stock remark reads input and output the same, except where declared", () => {
  it.each(EXAMPLES)("$id ($section)", (example) => {
    const undeclared = roundtripOf(example).independentRulerDivergences.filter(
      (d) =>
        !LEDGER.independentRuler.some((delta) => fidelityMatches(delta, d, example.id)),
    );
    expect(
      undeclared.map(
        (d) =>
          `${example.id} ${d.path} ${d.kind} ${d.detail} ` +
          `input=${JSON.stringify(d.documentValue)} output=${JSON.stringify(d.sourcePositionValue)}`,
      ),
    ).toEqual([]);
  });
});

describe("the roundtrip ledger cannot rot into a suppression file", () => {
  const examplesById = new Map(EXAMPLES.map((e) => [e.id, e]));

  it("every stability declaration still matches both pass outputs", () => {
    const stale = LEDGER.stability.filter((d) => {
      const example = examplesById.get(d.exampleId);
      if (!example) return true;
      const { pass1, pass2 } = roundtripOf(example);
      return (
        pass1 === pass2 ||
        d.pass1Sha256 !== sha256Of(pass1) ||
        d.pass2Sha256 !== sha256Of(pass2)
      );
    });
    expect(stale.map((d) => d.exampleId)).toEqual([]);
  });

  it("every fidelity declaration matches a real divergence", () => {
    const stale = LEDGER.fidelity.filter((delta) => {
      const example = examplesById.get(delta.exampleId);
      if (!example) return true;
      return !roundtripOf(example).fidelityDivergences.some((d) =>
        fidelityMatches(delta, d, delta.exampleId),
      );
    });
    expect(
      stale.map((d) => `${d.exampleId} ${d.path} ${d.kind} ${d.detail}`),
    ).toEqual([]);
  });

  it("every independent-ruler declaration matches a real divergence", () => {
    const stale = LEDGER.independentRuler.filter((delta) => {
      const example = examplesById.get(delta.exampleId);
      if (!example) return true;
      return !roundtripOf(example).independentRulerDivergences.some((d) =>
        fidelityMatches(delta, d, delta.exampleId),
      );
    });
    expect(
      stale.map((d) => `${d.exampleId} ${d.path} ${d.kind} ${d.detail}`),
    ).toEqual([]);
  });

  it("every declaration carries a stated reason", () => {
    expect(
      reasonsAreStated([
        ...LEDGER.stability,
        ...LEDGER.fidelity,
        ...LEDGER.independentRuler,
      ]),
    ).toEqual([]);
  });
});
