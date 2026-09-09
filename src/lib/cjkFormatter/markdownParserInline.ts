/**
 * Inline Span Detectors for the Protected-Region Scanner
 *
 * Purpose: detectors 3 through 11 — the constructs that live INSIDE a line
 * rather than owning one. Inline code, images, link URLs, HTML tags, HTML
 * character references, wiki links, footnote definitions and references, and
 * both math forms.
 *
 * Split out of markdownParser.ts when adding the character-reference detector
 * (#1382) took that file past the 300-line limit. The seam mirrors the one
 * already there for markdownParserBlocks.ts: document scaffolding and fences
 * stay in the parent, line-oriented blocks are in Blocks, spans are here.
 *
 * Order is load-bearing and preserved exactly as it was: images before links
 * (or an image gets URL-only protection), footnote DEFINITIONS before
 * references (or `[^1]:` splits into a reference plus a stray colon), and
 * character references after HTML tags (so `&amp;` inside an attribute is
 * already claimed and cannot be split out of its tag). Each detector guards
 * its match START with isInsideRegion, so a construct nested in an earlier
 * region is not double-protected.
 *
 * Appends to `regions` IN PLACE, like detectLineOrientedRegions, because the
 * detectors are order-dependent and each reads what the previous ones claimed.
 *
 * @coordinates-with markdownParser.ts — calls this between the fence and block passes
 * @coordinates-with characterReferences.ts — the shared reference pattern
 * @module lib/cjkFormatter/markdownParserInline
 */

import type { ProtectedRegion } from "./types";
import { characterReferenceMatcher } from "./characterReferences";
import { isInsideRegion } from "./protectedRegionSearch";

/** Detectors 3-11. Appends to `regions` in place. */
export function detectInlineSpanRegions(text: string, regions: ProtectedRegion[]): void {
  let match: RegExpExecArray | null;

  // 3. Inline code (backticks, handling escaped and multiple backticks)
  // Match `code` or ``code with ` inside`` etc.
  const inlineCodeRegex = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  while ((match = inlineCodeRegex.exec(text)) !== null) {
    // Skip if inside a fenced code block
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "inline_code",
      });
    }
  }

  // 4. Images: ![alt](url) or ![alt](url "title")
  const imageRegex = /!\[[^\]]*\]\([^)]+\)/g;
  while ((match = imageRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "image",
      });
    }
  }

  // 5. Link URLs: [text](url) - protect only the URL part
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  while ((match = linkRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      // Calculate the position of the URL part (after ](
      const urlStart = match.index + match[1].length + 3; // [text](
      const urlEnd = match.index + match[0].length - 1; // before )
      regions.push({
        start: urlStart,
        end: urlEnd,
        type: "link_url",
      });
    }
  }

  // 6. HTML tags (including self-closing and with attributes)
  const htmlTagRegex = /<[a-zA-Z][^>]*>|<\/[a-zA-Z][^>]*>/g;
  while ((match = htmlTagRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "html_tag",
      });
    }
  }

  // 6b. HTML character references: &copy; &#20854; &#x5176; (issue #1382).
  //     A reference is punctuation wrapped around text, so every rule that
  //     rewrites punctuation could reach its terminating `;` — and
  //     normalizeFullwidthPunctuation did, turning `&#x5176;实` into
  //     `&#x5176；实`. That is no longer a reference: it parses as literal text
  //     and is backslash-escaped on the next save, so the document silently
  //     stops saying what the user wrote.
  //
  //     Reachable WITHOUT the user typing an entity, which is why it went
  //     unnoticed: the WYSIWYG serializer emits one at a strong/emphasis
  //     delimiter boundary, so bolding `满足自己的需求。` and leaving `其实`
  //     outside produces `**满足自己的需求。**&#x5176;实` on its own.
  //
  //     After the HTML-tag pass, so `&amp;` inside an attribute is already
  //     claimed and cannot be split out of its tag.
  const characterReferenceRegex = characterReferenceMatcher();
  while ((match = characterReferenceRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "character_reference",
      });
    }
  }

  // 7. Wiki links: [[target]] or [[target|display]]
  const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  while ((match = wikiLinkRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "wiki_link",
      });
    }
  }

  // 8. Footnote definitions: [^1]: content (protect the marker, not content)
  // Must be detected BEFORE references so [^1]: doesn't get split
  const footnoteDefRegex = /^\[\^[^\]]+\]:/gm;
  while ((match = footnoteDefRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "footnote_def",
      });
    }
  }

  // 9. Footnote references: [^1], [^note], etc.
  const footnoteRefRegex = /\[\^[^\]]+\]/g;
  while ((match = footnoteRefRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "footnote_ref",
      });
    }
  }

  // 10. Math blocks: $$...$$  (display math)
  const mathBlockRegex = /\$\$[\s\S]*?\$\$/g;
  while ((match = mathBlockRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "math_block",
      });
    }
  }

  // 11. Inline math: $...$ (but not $$, and not escaped \$).
  //
  //     The padding rule is micromark's, and it is the whole reason this is
  //     not a naive `\$[^$\n]+\$` (WI-CJKF4.1): content may be padded with one
  //     space on BOTH sides, but one-sided padding is not math at all. Without
  //     it, `价格是 $100 和 $200 元` and `cost $5, tax $1` were "protected" —
  //     which skipped the CJK rules inside them AND made the space in front of
  //     the span a segment edge, so it was eaten as trailing whitespace.
  //
  //     `mathRegionParity.test.ts` checks a corpus against `parseMarkdown`
  //     itself, so this cannot drift away from what VMark renders.
  const mathInlineRegex = /(?<![\\$])\$(?!\$)([^$\n]+)\$(?!\$)/g;
  while ((match = mathInlineRegex.exec(text)) !== null) {
    if (isInsideRegion(match.index, regions)) continue;
    const content = match[1];
    const paddedLeft = /^[ \t]/.test(content);
    const paddedRight = /[ \t]$/.test(content);
    if (paddedLeft !== paddedRight) continue;
    // An all-whitespace run is padding with nothing to pad.
    if (paddedLeft && content.trim() === "") continue;
    // A trailing backslash would escape the closing delimiter.
    if (content.endsWith("\\")) continue;
    regions.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "math_inline",
    });
  }
}
