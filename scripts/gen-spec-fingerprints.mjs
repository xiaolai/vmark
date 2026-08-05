#!/usr/bin/env node
/**
 * Regenerate the spec-gate divergence fingerprints.
 *
 * The gates pin the EXACT set of divergences for every declared example, so
 * a declaration cannot become a blanket licence. When a deliberate change
 * alters those divergences, the gate fails and points here; run this, then
 * REVIEW THE DIFF — a changed path or value means the observed behaviour
 * changed, which is exactly what wants looking at.
 *
 *   node scripts/gen-spec-fingerprints.mjs
 *
 * Implemented as a vitest run because the fingerprints must come from the
 * same code paths the gates use (schema, plugins, aliases), not a
 * re-implementation of them.
 */
import { spawnSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const HARNESS = "src/utils/markdownPipeline/__tests__/spec/__genfp.test.ts";

const SOURCE = `// AUTO-GENERATED HARNESS — written and removed by
// scripts/gen-spec-fingerprints.mjs. Do not commit.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { parseMarkdownToMdast } from "../../parser";
import { project } from "../../conformance/semanticProjection";
import { diff } from "../../conformance/projectionDiff";
import { getProductionSchema } from "@/test/productionSchema";
import { ALL_EXAMPLES } from "@/test/markdownSpecCorpus";
import { fingerprintOf } from "@/test/specFingerprints";
import { coveringDelta } from "./specDeltas";
import { coveringFidelityDelta } from "./specRoundtripDeltas";

const here = dirname(fileURLToPath(import.meta.url));
const reference = unified().use(remarkParse).use(remarkGfm);
const schema = getProductionSchema();

it("generate", () => {
  const parseFp = {};
  const rtFp = {};
  for (const e of ALL_EXAMPLES) {
    if (coveringDelta(e.id)) {
      parseFp[e.id] = diff(
        project(reference.runSync(reference.parse(e.markdown))),
        project(parseMarkdownToMdast(e.markdown)),
        "root",
        { pinAttributesAcrossTypes: true },
      ).map(fingerprintOf);
    }
    if (coveringFidelityDelta(e.id)) {
      const once = serializeMarkdown(schema, parseMarkdown(schema, e.markdown));
      rtFp[e.id] = diff(
        project(parseMarkdownToMdast(e.markdown)),
        project(parseMarkdownToMdast(once)),
        "root",
        { pinAttributesAcrossTypes: true },
      ).map(fingerprintOf);
    }
  }
  writeFileSync(join(here, "fingerprints", "parse.json"), JSON.stringify(parseFp, null, 1) + "\\n");
  writeFileSync(join(here, "fingerprints", "roundtrip.json"), JSON.stringify(rtFp, null, 1) + "\\n");
});
`;

writeFileSync(HARNESS, SOURCE);
try {
  const result = spawnSync("pnpm", ["exec", "vitest", "run", HARNESS], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log("\nFingerprints regenerated. REVIEW THE DIFF before committing.");
} finally {
  unlinkSync(HARNESS);
}
