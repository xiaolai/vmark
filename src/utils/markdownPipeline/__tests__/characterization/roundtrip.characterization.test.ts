/**
 * Markdown pipeline — corpus characterization harness.
 *
 * Purpose: lock the WHOLE-DOCUMENT behavior of the markdown round-trip
 * (markdown → ProseMirror doc → markdown) so that a refactor of
 * src/utils/markdownPipeline is provably behavior-preserving. This is the
 * corpus-level complement to the unit-level fixed-point tests in
 * __tests__/serializer-idempotency.test.ts and backslash-roundtrip.test.ts:
 * those assert targeted inputs; this asserts entire real-world documents.
 *
 * Two invariants are checked per corpus document:
 *
 *   1. Idempotence — `serialize(parse(x))` must be a fixed point: feeding the
 *      canonical output back through the pipeline must not change it again.
 *      A hard failure here is a genuine serializer bug (e.g. asterisk-run
 *      growth or entity injection, the #1102 bug class).
 *
 *   2. Golden approval — the canonical output must match a committed snapshot
 *      in ./__golden__/. ANY change to the canonical markdown surfaces as a
 *      golden diff in the normal `pnpm test` run, so pipeline-refactor drift
 *      cannot land silently.
 *
 * Refactor workflow:
 *   - Before refactoring the pipeline, drop representative real-world documents
 *     into ./corpus/ and run this file once to capture their goldens (the
 *     goldens are git-tracked).
 *   - Refactor. Re-run. A green run proves byte-for-byte-identical output; a
 *     golden diff is the exact behavior change to review, then accept with
 *     `pnpm test -u`.
 *
 * Extending coverage = drop a `.md` file into ./corpus/. No code change is
 * needed; the harness auto-discovers every file. Goldens are (re)generated on
 * the next local run and reviewed as part of the diff.
 *
 * @coordinates-with ../../adapter.ts — the parseMarkdown/serializeMarkdown
 *   entry points under test
 * @coordinates-with src/test/productionSchema.ts — the schema the round-trip
 *   uses (a projection of the real editor composition, NOT a hand-kept mirror)
 * @module utils/markdownPipeline/__tests__/characterization
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseMarkdown, serializeMarkdown } from "../../adapter";
import { getProductionSchema } from "@/test/productionSchema";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = join(here, "corpus");
const goldenDir = join(here, "__golden__");

/**
 * The pipeline's canonical operation: markdown → PM doc → markdown.
 *
 * Uses the PRODUCTION schema projection, not the hand-mirrored testSchema.
 * testSchema lacks `toc`, `block_video`, `block_audio`, and `video_embed`, and
 * the converters return `null` for absent node types — so those constructs
 * round-trip to nothing and a golden would record the deletion as correct.
 * See src/test/productionSchema.ts and ../../schemaCoverage.test.ts.
 */
function roundTrip(md: string): string {
  const schema = getProductionSchema();
  return serializeMarkdown(schema, parseMarkdown(schema, md));
}

const corpus = readdirSync(corpusDir)
  .filter((f) => f.endsWith(".md"))
  .sort();

describe("markdown pipeline corpus characterization", () => {
  // A silently-empty corpus would report green while guarding nothing.
  it("discovers a non-empty corpus", () => {
    expect(corpus.length).toBeGreaterThan(0);
  });

  for (const file of corpus) {
    describe(file, () => {
      const input = readFileSync(join(corpusDir, file), "utf8");
      const canonical = roundTrip(input);

      it("serializer reaches a fixed point (idempotence)", () => {
        expect(roundTrip(canonical)).toBe(canonical);
      });

      it("matches its committed golden output (approval)", async () => {
        await expect(canonical).toMatchFileSnapshot(join(goldenDir, file));
      });
    });
  }
});
