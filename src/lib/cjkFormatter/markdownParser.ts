/**
 * Markdown Protected Region Scanner
 *
 * Purpose: Identifies regions in markdown text that must be excluded from CJK
 * formatting. Without this, the formatter would corrupt code blocks, URLs,
 * math expressions, wiki links, and other structural markdown.
 *
 * Key decisions:
 *   - Detection order matters: fenced code blocks first, then inline code,
 *     then images (before links to avoid URL-only protection on images),
 *     then link URLs, HTML tags, character references, wiki links, footnotes,
 *     math, indented code
 *   - HTML CHARACTER REFERENCES are protected (#1382). A reference is
 *     punctuation wrapped around text, so any rule that rewrites punctuation
 *     can reach its terminating `;` — and the fullwidth rule did, turning
 *     `&#x5176;实` into `&#x5176；实`, which parses as literal text and is
 *     escaped on the next save. Reachable without the user typing an entity,
 *     because the WYSIWYG serializer emits one at a strong/emphasis delimiter
 *     boundary. See characterReferences.ts for why the match is shape-based
 *   - Frontmatter covers BOTH delimiters, `---` (YAML) and `+++` (TOML)
 *   - An UNCLOSED fence claims the rest of the document, as CommonMark says;
 *     a document being edited is unterminated most of the time
 *   - Each regex checks isInsideRegion before adding, so nested constructs
 *     (e.g., inline code inside a fenced block) are not double-protected
 *   - Link URLs protect only the URL part [text](URL), not the display text,
 *     so CJK in link text is still formatted
 *   - Footnote definitions are detected before references so [^1]: is not
 *     split into a reference + stray colon
 *   - Indented code detection skips list continuations by checking previous
 *     non-blank line for list markers
 *   - Thematic breaks (---) are protected to avoid dash-to-emdash conversion
 *   - Reference sections (## References, ## Further Reading) can be optionally
 *     skipped via skipReferenceSections option to protect bibliographic formatting
 *   - Overlapping or contained regions are coalesced before returning, so
 *     callers can rely on sorted, strictly non-overlapping regions
 *
 * @coordinates-with formatter.ts — calls findProtectedRegions before formatting
 * @coordinates-with segments.ts — segment extraction/reconstruction over these regions
 * @coordinates-with rules.ts — formatting rules operate only on non-protected segments
 * @module lib/cjkFormatter/markdownParser
 */

import type { ProtectedRegion, ProtectedRegionOptions } from "./types";
import { detectLineOrientedRegions } from "./markdownParserBlocks";
import { detectInlineSpanRegions } from "./markdownParserInline";
import { isInsideRegion } from "./protectedRegionSearch";

/**
 * Find all protected regions in markdown text.
 * These regions should be skipped during CJK formatting.
 */
export function findProtectedRegions(
  text: string,
  options: ProtectedRegionOptions = {}
): ProtectedRegion[] {
  const regions: ProtectedRegion[] = [];

  // 1. Frontmatter (must be at start of document).
  //    Both delimiters: YAML `---` and TOML `+++`. TOML was missing, so a Hugo
  //    post's `title = "中文"` lost its straight quotes to smart-quote
  //    conversion and stopped parsing (WI-CJKF2.3). The empty-block form
  //    (`+++\n+++`) is legal and has no body, hence the `*` alternative.
  const frontmatterMatch = text.match(
    /^(---|\+\+\+)\r?\n(?:[\s\S]*?\r?\n)?\1(?=\r?\n|$)/
  );
  if (frontmatterMatch) {
    regions.push({
      start: 0,
      end: frontmatterMatch[0].length,
      type: "frontmatter",
    });
  }

  // 1b. Thematic breaks (horizontal rules): ---, ***, ___ on their own line
  // Must be 3+ of same char, optionally with spaces between, on its own line
  const thematicBreakRegex = /^[ \t]*([-*_])(?:[ \t]*\1){2,}[ \t]*$/gm;
  let thematicMatch;
  while ((thematicMatch = thematicBreakRegex.exec(text)) !== null) {
    // Skip if this is part of frontmatter (already protected)
    if (!isInsideRegion(thematicMatch.index, regions)) {
      regions.push({
        start: thematicMatch.index,
        end: thematicMatch.index + thematicMatch[0].length,
        type: "thematic_break",
      });
    }
  }

  // 2. Fenced code blocks (``` or ~~~), paired first.
  //    Up to three spaces of indentation is a legal fence; four is indented
  //    code, which detector 12 owns.
  //
  //    The closer must be AT LEAST as long as the opener (CommonMark), which
  //    needs the fence CHARACTER captured separately from the run: `\2` pins
  //    the opener's exact length and `\3*` allows more of the same character
  //    after it. Matching `\2` alone — as this did — refuses a legal
  //    ```` ``` ````-opened block closed by four backticks, and the block then
  //    falls through to the unclosed-fence rule below and swallows the rest of
  //    the document.
  const fencedCodeRegex =
    /^([ ]{0,3})((`|~)\3{2,})([^\n]*)\n([\s\S]*?)^[ ]{0,3}\2\3*[ \t]*$/gm;
  let match;
  while ((match = fencedCodeRegex.exec(text)) !== null) {
    regions.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "fenced_code",
    });
  }

  // 2b. An UNCLOSED fence claims the rest of the document (WI-CJKF2.2).
  //     CommonMark closes an unterminated fence at end of input, and a document
  //     being edited is unterminated most of the time — so without this, the
  //     SAFE entry point rewrote the code the user was in the middle of typing:
  //     `s = {'中文key': 1}` came back as `s = {‘中文 key’: 1}`, a broken Python
  //     string literal. Detected on the ORIGINAL text and skipped when already
  //     inside a paired fence, so a closed block's interior cannot re-open one.
  const fenceOpenerRegex = /^[ ]{0,3}(`{3,}|~{3,})[^\n]*$/gm;
  let opener;
  while ((opener = fenceOpenerRegex.exec(text)) !== null) {
    if (isInsideRegion(opener.index, regions)) continue;
    regions.push({
      start: opener.index,
      end: text.length,
      type: "fenced_code",
    });
    break;
  }

  // Detectors 3-11 are the inline SPAN detectors; they live in
  // ./markdownParserInline.ts and append to `regions` in place, because
  // these detectors are order-dependent and each reads what the previous
  // ones claimed.
  detectInlineSpanRegions(text, regions);

  // Detectors 12 (indented code) and 13 (reference sections) are the two
  // line-oriented ones; they live in ./markdownParserBlocks.ts and append to
  // `regions` in place, because these detectors are order-dependent.
  detectLineOrientedRegions(text, regions, options);

  // Sort by start position
  regions.sort((a, b) => a.start - b.start);

  // Coalesce overlapping or contained regions. Detectors only guard their
  // match START against existing regions, so a later-pass region can fully
  // contain an earlier one (e.g. an indented code block containing a link
  // URL, or a reference section containing anything). Segment extraction and
  // reconstruction require strictly non-overlapping regions — without this
  // pass, the overlapped range would be emitted twice in the output.
  // A merged region keeps the type of the earliest-starting region.
  const merged: ProtectedRegion[] = [];
  for (const region of regions) {
    const last = merged[merged.length - 1];
    if (last && region.start < last.end) {
      if (region.end > last.end) last.end = region.end;
    } else {
      merged.push({ ...region });
    }
  }

  return merged;
}

