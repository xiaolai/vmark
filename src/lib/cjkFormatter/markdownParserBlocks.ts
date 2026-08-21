/**
 * The two LINE-ORIENTED protected-region detectors.
 *
 * Purpose: indented code blocks and opt-in reference sections both need a
 * line-by-line walk rather than a regex over the whole text, which makes them
 * the two longest detectors by a wide margin. Split out of markdownParser.ts,
 * which owns the regex-driven ones and the coalescing pass.
 *
 * Both APPEND to the caller's `regions` array and read it for overlap, exactly
 * as they did inline — the detectors are order-dependent, and preserving that
 * order is the point of passing the array rather than returning a new one.
 *
 * @coordinates-with markdownParser.ts — findProtectedRegions calls these in order
 * @module lib/cjkFormatter/markdownParserBlocks
 */

import type { ProtectedRegion, ProtectedRegionOptions } from "./types";

/** Whether `pos` falls inside any region collected so far. */
function isInsideRegion(pos: number, regions: ProtectedRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/** Detectors 12 and 13, appended to `regions` in their established order. */
export function detectLineOrientedRegions(
  text: string,
  regions: ProtectedRegion[],
  options: ProtectedRegionOptions
): void {
  // 12. Indented code blocks (4+ spaces at line start, but not in lists)
  // This is tricky - we look for lines starting with 4+ spaces
  // that aren't list continuations
  const lines = text.split("\n");
  let pos = 0;
  let inIndentedBlock = false;
  let blockStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isIndented = /^( {4}|\t)/.test(line) && line.trim().length > 0;
    const isBlankLine = line.trim().length === 0;

    if (isIndented && !isInsideRegion(pos, regions)) {
      if (!inIndentedBlock) {
        // Check previous non-blank line - if it's a list item, this is continuation
        let prevNonBlank = i - 1;
        while (prevNonBlank >= 0 && lines[prevNonBlank].trim() === "") {
          prevNonBlank--;
        }
        // Fixed: group alternation to avoid precedence bug
        // Previous: /^[\s]*[-*+]|\d+\./ matched ^\s*[-*+] OR \d+. anywhere
        const isListContinuation =
          prevNonBlank >= 0 &&
          /^[\s]*(?:[-*+]|\d+\.)/.test(lines[prevNonBlank]);

        if (!isListContinuation) {
          inIndentedBlock = true;
          blockStart = pos;
        }
      }
    } else if (!isBlankLine && inIndentedBlock) {
      // End of indented block
      regions.push({
        start: blockStart,
        end: pos,
        type: "indented_code",
      });
      inIndentedBlock = false;
    }

    pos += line.length + 1; // +1 for newline
  }

  // Handle indented block at end of file
  if (inIndentedBlock) {
    regions.push({
      start: blockStart,
      end: text.length,
      type: "indented_code",
    });
  }

  // 13. Reference sections (opt-in): ## References, ## Further Reading
  // Academic/technical documents often have bibliographic entries with specific
  // punctuation that CJK formatting would corrupt (DOIs, citation commas, etc.)
  if (options.skipReferenceSections) {
    const refHeadingRegex = /^## (?:References|Further Reading)[ \t]*$/gm;
    const nextH2Regex = /^## /gm;
    let refMatch;
    while ((refMatch = refHeadingRegex.exec(text)) !== null) {
      if (isInsideRegion(refMatch.index, regions)) continue;
      // Find the next ## heading after this one
      nextH2Regex.lastIndex = refMatch.index + refMatch[0].length;
      const nextHeading = nextH2Regex.exec(text);
      const sectionEnd = nextHeading ? nextHeading.index : text.length;
      regions.push({
        start: refMatch.index,
        end: sectionEnd,
        type: "reference_section",
      });
    }
  }
}
