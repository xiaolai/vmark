/**
 * Latin Span Scanner
 *
 * Identifies "Latin spans" (runs of ASCII-ish characters) within text that
 * contains CJK characters. Used to protect punctuation inside technical
 * constructs like URLs, versions, decimals, and times.
 *
 * Spec Reference: Rule 2, Section 2.1 of cjk-typography-rules-draft.md
 */

// CJK letter detection (Han, Hiragana, Katakana, Bopomofo) — excluding Korean (Hangul).
// Unicode property escapes correctly handle supplementary-plane Han characters.
const CJK_LETTER_REGEX =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Bopomofo}]/u;

export type TechnicalSubspanType =
  | "urlLike"
  | "emailLike"
  | "domainLike"
  | "versionLike"
  | "decimalLike"
  | "timeLike"
  | "thousandsLike";

export interface TechnicalSubspan {
  /** Start position relative to the Latin span */
  start: number;
  /** End position relative to the Latin span */
  end: number;
  /** Type of technical construct */
  type: TechnicalSubspanType;
  /** The matched text */
  text: string;
}

export interface LatinSpan {
  /** Start position in the original text */
  start: number;
  /** End position in the original text (exclusive) */
  end: number;
  /** The Latin span text */
  text: string;
  /** Technical subspans within this Latin span (positions relative to span start) */
  subspans: TechnicalSubspan[];
}

/**
 * Technical pattern definitions
 * Order matters: more specific patterns should come first to prevent partial matches
 */
const TECHNICAL_PATTERNS: Array<{
  type: TechnicalSubspanType;
  pattern: RegExp;
}> = [
  // URL-like: starts with http:// or https://
  {
    type: "urlLike",
    pattern: /https?:\/\/[^\s]+/g,
  },
  // Email-like: contains @ with domain
  {
    type: "emailLike",
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
  },
  // Version-like: v1.2.3 or 1.2.3.4 (requires v prefix OR at least 2 dots)
  {
    type: "versionLike",
    pattern: /\b(?:v\d+(?:\.\d+)+|\d+(?:\.\d+){2,})\b/g,
  },
  // Time-like: 12:30 or 1:30
  {
    type: "timeLike",
    pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g,
  },
  // Thousands-like: 1,000 or 1,000,000
  {
    type: "thousandsLike",
    pattern: /\b\d{1,3}(?:,\d{3})+\b/g,
  },
  // Domain-like: example.com (must have dot, no spaces, not just numbers)
  {
    type: "domainLike",
    pattern: /\b[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z0-9.-]+[a-zA-Z]\b/g,
  },
  // Decimal-like: 3.14 (number.number)
  {
    type: "decimalLike",
    pattern: /\b\d+\.\d+\b/g,
  },
];

/**
 * Check if a character is a CJK letter (Han, Kana, Bopomofo)
 */
export function isCJKLetter(char: string): boolean {
  return CJK_LETTER_REGEX.test(char);
}

/**
 * Check if a character can be part of a Latin span
 * Allowed: A-Z, a-z, 0-9, whitespace, common ASCII punctuation
 */
function isLatinSpanChar(char: string): boolean {
  const code = char.charCodeAt(0);

  // Newline breaks spans
  if (char === "\n") return false;

  // Letters A-Z, a-z
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a))
    return true;

  // Digits 0-9
  if (code >= 0x30 && code <= 0x39) return true;

  // Whitespace (space, tab)
  if (char === " " || char === "\t") return true;

  // Common ASCII punctuation used in prose/tech
  const allowedPunctuation = '.,!?;:\'"()[]{}<>/-_@#&=+*%$\\|~`^';
  if (allowedPunctuation.includes(char)) return true;

  return false;
}

/**
 * Find technical subspans within a Latin span
 */
function findTechnicalSubspans(spanText: string): TechnicalSubspan[] {
  const subspans: TechnicalSubspan[] = [];
  const usedRanges: Array<[number, number]> = [];

  for (const { type, pattern } of TECHNICAL_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(spanText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;

      // Check if this range overlaps with an existing subspan
      const overlaps = usedRanges.some(
        ([usedStart, usedEnd]) =>
          (start >= usedStart && start < usedEnd) ||
          (end > usedStart && end <= usedEnd) ||
          (start <= usedStart && end >= usedEnd)
      );

      if (!overlaps) {
        subspans.push({
          start,
          end,
          type,
          text: match[0],
        });
        usedRanges.push([start, end]);
      }
    }
  }

  // Sort by start position
  subspans.sort((a, b) => a.start - b.start);

  return subspans;
}

/**
 * Scan text for Latin spans (runs of ASCII-ish characters between CJK)
 *
 * @param text The text to scan
 * @returns Array of Latin spans with their positions and technical subspans
 */
export function scanLatinSpans(text: string): LatinSpan[] {
  const spans: LatinSpan[] = [];
  let spanStart = -1;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    // Check for surrogate pairs (CJK Extension B-G)
    let fullChar = char;
    if (
      char.charCodeAt(0) >= 0xd800 &&
      char.charCodeAt(0) <= 0xdbff &&
      i + 1 < text.length
    ) {
      fullChar = char + text[i + 1];
    }

    const isCJK = isCJKLetter(fullChar);
    const isLatin = !isCJK && isLatinSpanChar(char);
    const isNewline = char === "\n";

    if (isLatin && spanStart === -1) {
      // Start a new Latin span
      spanStart = i;
    } else if ((!isLatin || isNewline) && spanStart !== -1) {
      // End the current Latin span
      const spanText = text.slice(spanStart, i);
      // Only add non-empty spans (trim whitespace-only spans)
      if (spanText.trim().length > 0) {
        spans.push({
          start: spanStart,
          end: i,
          text: spanText,
          subspans: findTechnicalSubspans(spanText),
        });
      }
      spanStart = -1;
    }

    // Advance by 2 for surrogate pairs
    if (fullChar.length === 2) {
      i += 2;
    } else {
      i += 1;
    }
  }

  // Handle span at end of text
  if (spanStart !== -1) {
    const spanText = text.slice(spanStart);
    if (spanText.trim().length > 0) {
      spans.push({
        start: spanStart,
        end: text.length,
        text: spanText,
        subspans: findTechnicalSubspans(spanText),
      });
    }
  }

  return spans;
}

/**
 * Check if a position is inside any Latin span
 */
export function isInLatinSpan(position: number, spans: LatinSpan[]): boolean {
  return spans.some((span) => position >= span.start && position < span.end);
}

/**
 * Get the technical subspan at a position, if any
 */
export function getTechnicalSubspanAt(
  position: number,
  spans: LatinSpan[]
): TechnicalSubspan | null {
  for (const span of spans) {
    if (position >= span.start && position < span.end) {
      const relativePos = position - span.start;
      for (const subspan of span.subspans) {
        if (relativePos >= subspan.start && relativePos < subspan.end) {
          return subspan;
        }
      }
    }
  }
  return null;
}

/**
 * Check if a position is inside a technical subspan (URL, version, etc.)
 */
export function isInTechnicalSubspan(
  position: number,
  spans: LatinSpan[]
): boolean {
  return getTechnicalSubspanAt(position, spans) !== null;
}
