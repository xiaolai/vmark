#!/usr/bin/env npx tsx
/**
 * Rewrites the parser-derived fields of the comment anchor goldens
 * (src/test/fixtures/agentJournal/commentAnchorGoldens.json) from the
 * production Markdown parser: heading depths, offsets and text, heading
 * paths, and widened block ranges with the quote and context that follow.
 * Hand-written fields (ids, Markdown, selections, scenario expectations) are
 * kept as they are.
 *
 * Usage: pnpm gen:comment-anchor-goldens [--check]
 *   --check  exit 1, writing nothing, when the file is not current.
 *
 * @coordinates-with src/test/commentAnchorGoldens.ts — the derivation itself
 * @coordinates-with src/services/agentJournal/comments/__tests__/anchorGoldens.test.ts — fails when the file is stale
 * @module scripts/gen-comment-anchor-goldens
 */

import fs from "node:fs";
import { deriveFromParser, GOLDEN_PATH, type CommentAnchorGoldens } from "../src/test/commentAnchorGoldens";
import { parseMarkdownToMdast } from "../src/utils/markdownPipeline/parser";

function main(): void {
  const check = process.argv.includes("--check");
  const current = fs.readFileSync(GOLDEN_PATH, "utf8");
  const goldens = JSON.parse(current) as CommentAnchorGoldens;
  const next = `${JSON.stringify(deriveFromParser(goldens, parseMarkdownToMdast), null, 2)}\n`;
  if (next === current) {
    console.log(`comment anchor goldens are current: ${GOLDEN_PATH}`);
    return;
  }
  if (check) {
    console.error(`comment anchor goldens are stale; run pnpm gen:comment-anchor-goldens: ${GOLDEN_PATH}`);
    process.exit(1);
  }
  fs.writeFileSync(GOLDEN_PATH, next);
  console.log(`wrote ${GOLDEN_PATH}`);
}

main();
