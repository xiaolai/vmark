/**
 * The one containment test the protected-region detectors share.
 *
 * Purpose: every detector guards its match START against the regions claimed
 * before it, which is what keeps a construct nested inside an earlier region
 * (inline code inside a fence, a link URL inside indented code) from being
 * protected twice and emitted twice by segment reconstruction.
 *
 * It lives here because the detectors are split across three modules for the
 * 300-line limit — markdownParser.ts, markdownParserInline.ts and
 * markdownParserBlocks.ts — and a predicate copied into each is a predicate
 * that can be fixed in one and left wrong in the others.
 *
 * Half-open on purpose: `end` is exclusive, so a region ending at `pos` does
 * not contain it and the next construct may start exactly where the last one
 * finished.
 *
 * @coordinates-with markdownParser.ts — frontmatter, thematic breaks, fences
 * @coordinates-with markdownParserInline.ts — detectors 3-11
 * @coordinates-with markdownParserBlocks.ts — detectors 12-13
 * @module lib/cjkFormatter/protectedRegionSearch
 */

import type { ProtectedRegion } from "./types";

/** Is `pos` inside any of `regions`? */
export function isInsideRegion(pos: number, regions: ProtectedRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}
