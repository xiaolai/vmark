/**
 * WI-0.1 — the triage dump: measure every divergence the two spec gates
 * would report, and write them to a JSON file for ledger authoring.
 *
 * Ledger entries must be MEASURED, not written from expectation —
 * `conformance/expectedDeltas.ts` records how a hand-written declaration got
 * the values wrong until the output said otherwise. This dump is how the
 * measuring happens: run it, group the dump by signature family, write
 * reasons, emit ledger records. Re-run whenever a corpus grows (WI-2.3).
 *
 * Inert by default: without SPEC_TRIAGE_DUMP=<path> it skips, asserts
 * nothing, and never writes.
 *
 * @coordinates-with specConformance.test.ts — computes the same divergences
 * @coordinates-with specRoundtrip.test.ts — computes the same roundtrip data
 * @module utils/markdownPipeline/__tests__/spec/specTriage.dump.test
 */
import { describe, it } from "vitest";
import { writeFileSync } from "node:fs";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import "../../dialect";
import { createProcessor } from "../../parser/processorFactory";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";
import { project, diff, type RawNode } from "../../conformance/semanticProjection";
import { examplesForRoute, sha256Of } from "./corpusRegistry";
import { UNDEFINED_SENTINEL } from "./specLedgers";

const DUMP_PATH = process.env.SPEC_TRIAGE_DUMP;

function jsonSafe(value: unknown): unknown {
  return value === undefined ? UNDEFINED_SENTINEL : value;
}

describe.runIf(Boolean(DUMP_PATH))("spec triage dump", () => {
  it("writes every observed divergence for ledger authoring", () => {
    const schema = getProductionSchema();
    const mdastOf = (markdown: string): RawNode => {
      const p = createProcessor(markdown);
      return p.runSync(p.parse(markdown)) as unknown as RawNode;
    };
    const referenceOf = (markdown: string): RawNode => {
      const p = unified().use(remarkParse).use(remarkGfm);
      return p.runSync(p.parse(markdown)) as unknown as RawNode;
    };

    const conformance = [];
    for (const example of examplesForRoute("conformance")) {
      for (const d of diff(
        project(mdastOf(example.markdown)),
        project(referenceOf(example.markdown)),
      )) {
        conformance.push({
          exampleId: example.id,
          section: example.section,
          path: d.path,
          kind: d.kind,
          detail: d.detail,
          vmarkValue: jsonSafe(d.documentValue),
          referenceValue: jsonSafe(d.sourcePositionValue),
        });
      }
    }

    const stability = [];
    const fidelity = [];
    const crashes = [];
    for (const example of examplesForRoute("roundtrip")) {
      try {
        const pass1 = serializeMarkdown(schema, parseMarkdown(schema, example.markdown));
        const pass2 = serializeMarkdown(schema, parseMarkdown(schema, pass1));
        if (pass1 !== pass2) {
          stability.push({
            exampleId: example.id,
            section: example.section,
            pass1,
            pass2,
            pass1Sha256: sha256Of(pass1),
            pass2Sha256: sha256Of(pass2),
          });
        }
        for (const d of diff(project(mdastOf(example.markdown)), project(mdastOf(pass1)))) {
          fidelity.push({
            exampleId: example.id,
            section: example.section,
            markdown: example.markdown,
            pass1,
            path: d.path,
            kind: d.kind,
            detail: d.detail,
            inputValue: jsonSafe(d.documentValue),
            outputValue: jsonSafe(d.sourcePositionValue),
          });
        }
      } catch (error) {
        crashes.push({
          exampleId: example.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    writeFileSync(
      DUMP_PATH!,
      JSON.stringify({ conformance, stability, fidelity, crashes }, null, 1),
    );
  });
});
