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
 *     then link URLs, HTML tags, wiki links, footnotes, math, indented code
 *   - Each regex checks isInsideRegion before adding, so nested constructs
 *     (e.g., inline code inside a fenced block) are not double-protected
 *   - Link URLs protect only the URL part [text](URL), not the display text,
 *     so CJK in link text is still formatted
 *   - Footnote definitions are detected before references so [^1]: is not
 *     split into a reference + stray colon
 *   - Indented code detection skips list continuations by checking previous
 *     non-blank line for list markers
 *   - Thematic breaks (---) are protected to avoid dash-to-emdash conversion
 *
 * @coordinates-with formatter.ts — calls findProtectedRegions before formatting
 * @coordinates-with rules.ts — formatting rules operate only on non-protected segments
 * @module lib/cjkFormatter/markdownParser
 */

export interface ProtectedRegion {
  start: number;
  end: number;
  type:
    | "fenced_code"
    | "inline_code"
    | "indented_code"
    | "link_url"
    | "image"
    | "frontmatter"
    | "html_tag"
    | "wiki_link"
    | "footnote_ref"
    | "footnote_def"
    | "math_block"
    | "math_inline"
    | "thematic_break";
}

/**
 * Find all protected regions in markdown text.
 * These regions should be skipped during CJK formatting.
 */
export function findProtectedRegions(text: string): ProtectedRegion[] {
  const regions: ProtectedRegion[] = [];

  // 1. Frontmatter (must be at start of document)
  const frontmatterMatch = text.match(/^---\r?\n[\s\S]*?\r?\n---/);
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

  // 2. Fenced code blocks (``` or ~~~)
  // Handle both normal case and code blocks at EOF without trailing newline
  const fencedCodeRegex = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
  let match;
  while ((match = fencedCodeRegex.exec(text)) !== null) {
    regions.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "fenced_code",
    });
  }

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

  // 11. Inline math: $...$ (but not $$ or escaped \$)
  // Be careful: $ is common in text, so we require content between them
  const mathInlineRegex = /(?<!\$)\$(?!\$)([^$\n]+)\$(?!\$)/g;
  while ((match = mathInlineRegex.exec(text)) !== null) {
    if (!isInsideRegion(match.index, regions)) {
      regions.push({
        start: match.index,
        end: match.index + match[0].length,
        type: "math_inline",
      });
    }
  }

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

  // Sort by start position
  regions.sort((a, b) => a.start - b.start);

  return regions;
}

/**
 * Check if a position is inside any of the given regions.
 */
function isInsideRegion(pos: number, regions: ProtectedRegion[]): boolean {
  return regions.some((r) => pos >= r.start && pos < r.end);
}

/**
 * Extract text segments that should be formatted (non-protected regions).
 * Returns array of { start, end, text } for regions to format.
 */
export interface TextSegment {
  start: number;
  end: number;
  text: string;
}

export function extractFormattableSegments(
  text: string,
  protectedRegions: ProtectedRegion[]
): TextSegment[] {
  const segments: TextSegment[] = [];
  let currentPos = 0;

  for (const region of protectedRegions) {
    if (region.start > currentPos) {
      segments.push({
        start: currentPos,
        end: region.start,
        text: text.slice(currentPos, region.start),
      });
    }
    currentPos = region.end;
  }

  // Add remaining text after last protected region
  if (currentPos < text.length) {
    segments.push({
      start: currentPos,
      end: text.length,
      text: text.slice(currentPos),
    });
  }

  return segments;
}

/**
 * Reconstruct the full text after formatting segments.
 */
export function reconstructText(
  originalText: string,
  formattedSegments: TextSegment[],
  protectedRegions: ProtectedRegion[]
): string {
  const parts: { start: number; text: string }[] = [];

  // Add protected regions
  for (const region of protectedRegions) {
    parts.push({
      start: region.start,
      text: originalText.slice(region.start, region.end),
    });
  }

  // Add formatted segments
  for (const segment of formattedSegments) {
    parts.push({
      start: segment.start,
      text: segment.text,
    });
  }

  // Sort by original position and join
  parts.sort((a, b) => a.start - b.start);
  return parts.map((p) => p.text).join("");
}
