/**
 * WI-3.1 — the pathological child entry, run under `tsx` by
 * `pathological.test.ts` so a synchronous parser/serializer hang is
 * KILLABLE. A vitest timeout cannot interrupt a busy loop on its own event
 * loop; a child process can always be terminated from outside.
 *
 * Runs the markdown pipeline against a StarterKit-only schema: the pipeline
 * (`src/utils/markdownPipeline/`) is leaf-pure by ADR-013, but the FULL
 * production assembly is Vite-native (`import.meta.glob` in i18n), so the
 * child stresses parse + serialize on the core schema — which is where every
 * cmark pathological class lives. The full-schema pipeline is exercised by
 * the spec gates on the (already-nasty, small) spec corpora.
 *
 * Protocol: one JSON line per completed case on stdout
 * (`{"name","parseMs","serializeMs"}`), `{"done":true}` at the end. The
 * PARENT owns all judgement; a case that hangs simply never prints, and the
 * last-started name (printed BEFORE running) identifies the culprit.
 *
 * `HANG_PROBE=1` runs a deliberate busy loop instead — the parent's
 * self-test proves the kill path works, per the plan's DoD.
 *
 * @module utils/markdownPipeline/__tests__/pathological/runCases
 */
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import "../../dialect";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { pathologicalCases } from "./pathologicalCases";

if (process.env.HANG_PROBE === "1") {
  console.log(JSON.stringify({ name: "hang-probe", starting: true }));
  for (;;) {
    // Deliberate synchronous hang — the parent must kill this process.
  }
}

const scale = Number(process.env.PATHOLOGICAL_SCALE ?? "1");
const schema = getSchema([StarterKit]);

for (const testCase of pathologicalCases(scale)) {
  console.log(JSON.stringify({ name: testCase.name, starting: true }));
  const t0 = performance.now();
  const doc = parseMarkdown(schema, testCase.markdown);
  const parseMs = performance.now() - t0;
  let serializeMs = 0;
  if (testCase.serialize) {
    const t1 = performance.now();
    serializeMarkdown(schema, doc);
    serializeMs = performance.now() - t1;
  }
  console.log(
    JSON.stringify({ name: testCase.name, parseMs: Math.round(parseMs), serializeMs: Math.round(serializeMs) }),
  );
}
console.log(JSON.stringify({ done: true }));
