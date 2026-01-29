/**
 * CJK Text Formatting Rules (Standalone for VitePress demo)
 * Simplified version of VMark's CJK formatter
 *
 * Features:
 * - Stack-based quote pairing with apostrophe/prime detection
 * - Latin span scanner for protecting technical constructs
 * - Contextual quote conversion
 * - Backslash escape preservation
 */

export type QuoteStyle = "curly" | "corner" | "guillemets";

export interface CJKFormattingSettings {
  // Group 1: Universal
  ellipsisNormalization: boolean;
  newlineCollapsing: boolean;
  // Group 2: Fullwidth Normalization
  fullwidthAlphanumeric: boolean;
  fullwidthPunctuation: boolean;
  fullwidthParentheses: boolean;
  fullwidthBrackets: boolean;
  // Group 3: Spacing
  cjkEnglishSpacing: boolean;
  cjkParenthesisSpacing: boolean;
  currencySpacing: boolean;
  slashSpacing: boolean;
  spaceCollapsing: boolean;
  // Group 4: Dash & Quote
  dashConversion: boolean;
  emdashSpacing: boolean;
  smartQuoteConversion: boolean;
  quoteStyle: QuoteStyle;
  contextualQuotes: boolean; // When true: curly for CJK context, straight for pure Latin
  quoteSpacing: boolean;
  singleQuoteSpacing: boolean;
  cjkCornerQuotes: boolean;
  cjkNestedQuotes: boolean;
  // Group 5: Cleanup
  consecutivePunctuationLimit: number;
  trailingSpaceRemoval: boolean;
}

export const defaultCJKSettings: CJKFormattingSettings = {
  ellipsisNormalization: true,
  newlineCollapsing: true,
  fullwidthAlphanumeric: true,
  fullwidthPunctuation: true,
  fullwidthParentheses: true,
  fullwidthBrackets: false, // OFF by default
  cjkEnglishSpacing: true,
  cjkParenthesisSpacing: true,
  currencySpacing: true,
  slashSpacing: true,
  spaceCollapsing: true,
  dashConversion: true,
  emdashSpacing: true,
  smartQuoteConversion: true,
  quoteStyle: "curly",
  contextualQuotes: true, // ON by default
  quoteSpacing: true,
  singleQuoteSpacing: true,
  cjkCornerQuotes: false, // OFF by default
  cjkNestedQuotes: false, // OFF by default
  consecutivePunctuationLimit: 0, // OFF by default
  trailingSpaceRemoval: true,
};

// Character ranges
const HAN = "\u4e00-\u9fff\u3400-\u4dbf";
const HIRAGANA = "\u3040-\u309f";
const KATAKANA = "\u30a0-\u30ff\u31f0-\u31ff";
const HANGUL = "\uac00-\ud7af\u1100-\u11ff\u3130-\u318f";
const BOPOMOFO = "\u3100-\u312f\u31a0-\u31bf";
const CJK_ALL = `${HAN}${BOPOMOFO}${HIRAGANA}${KATAKANA}${HANGUL}`;
const CJK_NO_KOREAN = `${HAN}${BOPOMOFO}${HIRAGANA}${KATAKANA}`;

const CJK_TERMINAL_PUNCTUATION = "，。！？；：、";
const CJK_CLOSING_BRACKETS = "》」』】）〉";
const CJK_OPENING_BRACKETS = "《「『【（〈";
const CJK_CHARS_PATTERN = `[${HAN}${HIRAGANA}${KATAKANA}《》「」『』【】（）〈〉，。！？；：、]`;

// CJK letter detection regex
const CJK_LETTER_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff\u3100-\u312f\u31a0-\u31bf]/;

// Punctuation conversion map (half-width → full-width)
const PUNCTUATION_MAP: Record<string, string> = {
  ",": "，",
  ".": "。",
  "!": "！",
  "?": "？",
  ";": "；",
  ":": "：",
};

// ============================================================
// Latin Span Scanner
// Protects technical constructs from CJK formatting rules
// ============================================================

interface TechnicalSubspan {
  start: number;
  end: number;
  type: string;
}

interface LatinSpan {
  start: number;
  end: number;
  text: string;
  subspans: TechnicalSubspan[];
}

const TECHNICAL_PATTERNS = [
  { type: "urlLike", pattern: /https?:\/\/[^\s]+/g },
  { type: "emailLike", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: "versionLike", pattern: /\b(?:v\d+(?:\.\d+)+|\d+(?:\.\d+){2,})\b/g },
  { type: "timeLike", pattern: /\b\d{1,2}:\d{2}(?::\d{2})?\b/g },
  { type: "thousandsLike", pattern: /\b\d{1,3}(?:,\d{3})+\b/g },
  { type: "domainLike", pattern: /\b[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z0-9.-]+[a-zA-Z]\b/g },
  { type: "decimalLike", pattern: /\b\d+\.\d+\b/g },
];

function isCJKLetter(char: string): boolean {
  return CJK_LETTER_REGEX.test(char);
}

function isLatinSpanChar(char: string): boolean {
  const code = char.charCodeAt(0);
  if (char === "\n") return false;
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return true;
  if (code >= 0x30 && code <= 0x39) return true;
  if (char === " " || char === "\t") return true;
  const allowedPunctuation = '.,!?;:\'"()[]{}<>/-_@#&=+*%$\\|~`^';
  return allowedPunctuation.includes(char);
}

function findTechnicalSubspans(spanText: string): TechnicalSubspan[] {
  const subspans: TechnicalSubspan[] = [];
  const usedRanges: Array<[number, number]> = [];

  for (const { type, pattern } of TECHNICAL_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(spanText)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      const overlaps = usedRanges.some(
        ([usedStart, usedEnd]) =>
          (start >= usedStart && start < usedEnd) ||
          (end > usedStart && end <= usedEnd) ||
          (start <= usedStart && end >= usedEnd)
      );
      if (!overlaps) {
        subspans.push({ start, end, type });
        usedRanges.push([start, end]);
      }
    }
  }
  return subspans.sort((a, b) => a.start - b.start);
}

function scanLatinSpans(text: string): LatinSpan[] {
  const spans: LatinSpan[] = [];
  let spanStart = -1;

  for (let i = 0; i <= text.length; i++) {
    const char = i < text.length ? text[i] : "";
    const isCJK = char && isCJKLetter(char);
    const isLatin = char && !isCJK && isLatinSpanChar(char);

    if (isLatin && spanStart === -1) {
      spanStart = i;
    } else if (!isLatin && spanStart !== -1) {
      const spanText = text.slice(spanStart, i);
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
  }
  return spans;
}

function isInTechnicalSubspan(position: number, spans: LatinSpan[]): boolean {
  for (const span of spans) {
    if (position >= span.start && position < span.end) {
      const relativePos = position - span.start;
      for (const subspan of span.subspans) {
        if (relativePos >= subspan.start && relativePos < subspan.end) {
          return true;
        }
      }
    }
  }
  return false;
}

// ============================================================
// Stack-based Quote Pairing
// ============================================================

type QuoteType = "double" | "single";
type QuoteRole = "open" | "close" | "apostrophe" | "prime";

interface QuoteToken {
  index: number;
  char: string;
  type: QuoteType;
  role: QuoteRole;
}

interface QuotePair {
  openIndex: number;
  closeIndex: number;
  type: QuoteType;
  isCJKInvolved: boolean;
}

const STRAIGHT_DOUBLE = '"';
const STRAIGHT_SINGLE = "'";
const CURLY_DOUBLE_OPEN = "\u201c";
const CURLY_DOUBLE_CLOSE = "\u201d";
const CURLY_SINGLE_OPEN = "\u2018";
const CURLY_SINGLE_CLOSE = "\u2019";
const CORNER_DOUBLE_OPEN = "「";
const CORNER_DOUBLE_CLOSE = "」";
const CORNER_SINGLE_OPEN = "『";
const CORNER_SINGLE_CLOSE = "』";

const OPENING_BRACKETS = "([{（【《〈「『";
const CLOSING_BRACKETS = ")]}）】》〉」』";
const TERMINAL_PUNCTUATION = "，。！？；：、.,!?;:";

function isApostrophe(text: string, pos: number): boolean {
  const char = text[pos];
  if (char !== "'" && char !== CURLY_SINGLE_CLOSE && char !== CURLY_SINGLE_OPEN) return false;
  const before = pos > 0 ? text[pos - 1] : "";
  const after = pos < text.length - 1 ? text[pos + 1] : "";
  // Letter + ' + letter: don't, it's
  if (/[a-zA-Z]/.test(before) && /[a-zA-Z]/.test(after)) return true;
  // Possessive: Xiaolai's
  if (/[a-zA-Z]/.test(before) && after.toLowerCase() === "s") {
    const afterS = pos + 2 < text.length ? text[pos + 2] : "";
    if (!/[a-zA-Z]/.test(afterS)) return true;
  }
  return false;
}

function isDecadeAbbreviation(text: string, pos: number): boolean {
  const char = text[pos];
  if (char !== "'" && char !== CURLY_SINGLE_OPEN) return false;
  const before = pos > 0 ? text[pos - 1] : "";
  if (/[0-9]/.test(before)) return false;
  const after1 = pos + 1 < text.length ? text[pos + 1] : "";
  const after2 = pos + 2 < text.length ? text[pos + 2] : "";
  return /[0-9]/.test(after1) && /[0-9]/.test(after2);
}

function isPrime(text: string, pos: number): boolean {
  const char = text[pos];
  const before = pos > 0 ? text[pos - 1] : "";
  if ((char === "'" || char === CURLY_SINGLE_CLOSE) && /[0-9]/.test(before)) return true;
  if ((char === '"' || char === CURLY_DOUBLE_CLOSE) && /[0-9]/.test(before)) return true;
  return false;
}

function classifyQuote(
  text: string,
  pos: number,
  type: QuoteType,
  doubleStack: number[],
  singleStack: number[]
): QuoteRole {
  let leftNeighbor = "";
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] !== " " && text[i] !== "\t") {
      leftNeighbor = text[i];
      break;
    }
  }

  const atStart = pos === 0 || text[pos - 1] === "\n";
  const leftIsWhitespace = pos === 0 || /\s/.test(text[pos - 1]);
  const leftIsOpenBracket = OPENING_BRACKETS.includes(leftNeighbor);
  const rightIsWhitespace = pos === text.length - 1 || /\s/.test(text[pos + 1]);

  let rightNeighbor = "";
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") {
      rightNeighbor = text[i];
      break;
    }
  }
  const atEnd = pos === text.length - 1 || text[pos + 1] === "\n";
  const rightIsCloseBracket = CLOSING_BRACKETS.includes(rightNeighbor);
  const rightIsTerminal = TERMINAL_PUNCTUATION.includes(rightNeighbor);

  if (atStart || leftIsWhitespace || leftIsOpenBracket) return "open";
  if (atEnd || rightIsWhitespace || rightIsCloseBracket || rightIsTerminal) return "close";

  const stack = type === "double" ? doubleStack : singleStack;
  if (stack.length > 0) return "close";
  return "open";
}

function checkCJKInvolvement(text: string, openIndex: number, closeIndex: number): boolean {
  const content = text.slice(openIndex + 1, closeIndex);
  for (const char of content) {
    if (isCJKLetter(char)) return true;
  }
  if (openIndex > 0 && isCJKLetter(text[openIndex - 1])) return true;
  if (closeIndex < text.length - 1 && isCJKLetter(text[closeIndex + 1])) return true;
  return false;
}

function tokenizeQuotes(text: string): QuoteToken[] {
  const tokens: QuoteToken[] = [];
  const doubleStack: number[] = [];
  const singleStack: number[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    let type: QuoteType | null = null;

    if (char === STRAIGHT_DOUBLE || char === CURLY_DOUBLE_OPEN || char === CURLY_DOUBLE_CLOSE) {
      type = "double";
    } else if (char === STRAIGHT_SINGLE || char === CURLY_SINGLE_OPEN || char === CURLY_SINGLE_CLOSE) {
      type = "single";
    }

    if (!type) continue;

    if (type === "single" && isApostrophe(text, i)) {
      tokens.push({ index: i, char, type, role: "apostrophe" });
      continue;
    }
    if (type === "single" && isDecadeAbbreviation(text, i)) {
      tokens.push({ index: i, char, type, role: "apostrophe" });
      continue;
    }
    if (isPrime(text, i)) {
      tokens.push({ index: i, char, type, role: "prime" });
      continue;
    }

    const role = classifyQuote(text, i, type, doubleStack, singleStack);
    if (role === "open") {
      (type === "double" ? doubleStack : singleStack).push(i);
    } else if (role === "close") {
      const stack = type === "double" ? doubleStack : singleStack;
      if (stack.length > 0) stack.pop();
    }
    tokens.push({ index: i, char, type, role });
  }
  return tokens;
}

function pairQuotes(text: string, tokens: QuoteToken[]): QuotePair[] {
  const pairs: QuotePair[] = [];
  const doubleStack: QuoteToken[] = [];
  const singleStack: QuoteToken[] = [];

  for (const token of tokens) {
    if (token.role === "apostrophe" || token.role === "prime") continue;
    const stack = token.type === "double" ? doubleStack : singleStack;

    if (token.role === "open") {
      stack.push(token);
    } else if (token.role === "close" && stack.length > 0) {
      const opener = stack.pop()!;
      pairs.push({
        openIndex: opener.index,
        closeIndex: token.index,
        type: token.type,
        isCJKInvolved: checkCJKInvolvement(text, opener.index, token.index),
      });
    }
  }
  return pairs.sort((a, b) => a.openIndex - b.openIndex);
}

function applyContextualQuotes(
  text: string,
  mode: "off" | "curly-everywhere" | "contextual" | "corner-for-cjk"
): string {
  if (mode === "off") return text;

  const tokens = tokenizeQuotes(text);
  const pairs = pairQuotes(text, tokens);
  const replacements = new Map<number, string>();

  for (const pair of pairs) {
    let openQuote: string;
    let closeQuote: string;

    if (mode === "curly-everywhere") {
      openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
      closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
    } else if (mode === "contextual") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CURLY_DOUBLE_OPEN : CURLY_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CURLY_DOUBLE_CLOSE : CURLY_SINGLE_CLOSE;
      } else {
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else if (mode === "corner-for-cjk") {
      if (pair.isCJKInvolved) {
        openQuote = pair.type === "double" ? CORNER_DOUBLE_OPEN : CORNER_SINGLE_OPEN;
        closeQuote = pair.type === "double" ? CORNER_DOUBLE_CLOSE : CORNER_SINGLE_CLOSE;
      } else {
        openQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
        closeQuote = pair.type === "double" ? STRAIGHT_DOUBLE : STRAIGHT_SINGLE;
      }
    } else {
      continue;
    }

    replacements.set(pair.openIndex, openQuote);
    replacements.set(pair.closeIndex, closeQuote);
  }

  let result = "";
  for (let i = 0; i < text.length; i++) {
    result += replacements.has(i) ? replacements.get(i) : text[i];
  }
  return result;
}

// ============================================================
// Helper Functions
// ============================================================

function getLeftNeighbor(text: string, pos: number): string {
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] !== " " && text[i] !== "\t") return text[i];
  }
  return "";
}

function getRightNeighbor(text: string, pos: number): string {
  for (let i = pos + 1; i < text.length; i++) {
    if (text[i] !== " " && text[i] !== "\t") return text[i];
  }
  return "";
}

export function containsCJK(text: string): boolean {
  if (/[\u4e00-\u9fff\u3400-\u4dbf]/.test(text)) return true;
  if (/[\u3040-\u309f\u30a0-\u30ff\u31f0-\u31ff]/.test(text)) return true;
  if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(text)) return true;
  if (/[\u3100-\u312f\u31a0-\u31bf]/.test(text)) return true;
  return false;
}

// ============================================================
// Group 1: Universal
// ============================================================

export function normalizeEllipsis(text: string): string {
  text = text.replace(/\s*\.\s+\.\s+\.(?:\s+\.)*/g, "...");
  text = text.replace(/\.\.\.\s*(?=\S)/g, "... ");
  return text;
}

export function collapseNewlines(text: string): string {
  text = text.replace(/(\n\n)(<br\s*\/?>\n\n)+/g, "\n\n");
  text = text.replace(/\n\n<br\s*\/?>\n\n/g, "\n\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return text;
}

// ============================================================
// Group 2: Fullwidth Normalization
// ============================================================

export function normalizeFullwidthAlphanumeric(text: string): string {
  let result = "";
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code >= 0xff10 && code <= 0xff19) {
      result += String.fromCharCode(code - 0xfee0);
    } else if (code >= 0xff21 && code <= 0xff3a) {
      result += String.fromCharCode(code - 0xfee0);
    } else if (code >= 0xff41 && code <= 0xff5a) {
      result += String.fromCharCode(code - 0xfee0);
    } else {
      result += char;
    }
  }
  return result;
}

function isPartOfEllipsis(text: string, pos: number): boolean {
  if (text[pos] !== ".") return false;
  const before = pos > 0 ? text[pos - 1] : "";
  const after = pos < text.length - 1 ? text[pos + 1] : "";
  return before === "." || after === ".";
}

export function normalizeFullwidthPunctuation(text: string): string {
  const latinSpans = scanLatinSpans(text);
  const result: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const fullwidth = PUNCTUATION_MAP[char];

    if (!fullwidth) {
      result.push(char);
      continue;
    }

    // Backslash escape - never convert
    if (i > 0 && text[i - 1] === "\\") {
      result.push(char);
      continue;
    }

    // Ellipsis - never convert
    if (char === "." && isPartOfEllipsis(text, i)) {
      result.push(char);
      continue;
    }

    // Technical subspan - never convert
    if (isInTechnicalSubspan(i, latinSpans)) {
      result.push(char);
      continue;
    }

    const leftNeighbor = getLeftNeighbor(text, i);
    const rightNeighbor = getRightNeighbor(text, i);

    const leftIsCJK = leftNeighbor && (
      isCJKLetter(leftNeighbor) ||
      CJK_CLOSING_BRACKETS.includes(leftNeighbor) ||
      CJK_TERMINAL_PUNCTUATION.includes(leftNeighbor)
    );
    const rightIsCJK = rightNeighbor && (
      isCJKLetter(rightNeighbor) ||
      CJK_OPENING_BRACKETS.includes(rightNeighbor)
    );

    if (leftIsCJK || rightIsCJK) {
      result.push(fullwidth);
    } else {
      result.push(char);
    }
  }

  return result.join("");
}

export function normalizeFullwidthParentheses(text: string): string {
  return text.replace(new RegExp(`\\(([${CJK_NO_KOREAN}][^()]*)\\)`, "g"), "（$1）");
}

export function normalizeFullwidthBrackets(text: string): string {
  return text.replace(new RegExp(`\\[([${CJK_NO_KOREAN}][^\\[\\]]*)\\]`, "g"), "【$1】");
}

// ============================================================
// Group 3: Spacing
// ============================================================

export function addCJKEnglishSpacing(text: string): string {
  const alphanumPattern = "(?:[$¥€£₹][ ]?)?[A-Za-z0-9]+(?:[%‰℃℉]|°[CcFf]?|[ ]?(?:USD|CNY|EUR|GBP|RMB))?";
  text = text.replace(new RegExp(`([${CJK_ALL}])(${alphanumPattern})`, "g"), "$1 $2");
  text = text.replace(new RegExp(`(${alphanumPattern})([${CJK_ALL}])`, "g"), "$1 $2");
  return text;
}

export function addCJKParenthesisSpacing(text: string): string {
  text = text.replace(new RegExp(`([${CJK_ALL}])\\(`, "g"), "$1 (");
  text = text.replace(new RegExp(`\\)([${CJK_ALL}])`, "g"), ") $1");
  return text;
}

export function fixCurrencySpacing(text: string): string {
  // Prefix currency symbols bind tight
  text = text.replace(/([$¥€£₹])\s+(\d)/g, "$1$2");
  // Unit symbols bind tight to preceding number
  text = text.replace(/(\d)\s+(%|‰|℃|℉|°[CcFf]?)(?=[\s,;.。，；、！？!?)\]」』】〉》)]|$)/g, "$1$2");
  // Postfix currency codes: add space
  text = text.replace(/(\d)(USD|CNY|EUR|GBP|RMB|JPY)\b/g, "$1 $2");
  return text;
}

export function fixSlashSpacing(text: string): string {
  return text.replace(/(?<![/:])\s*\/\s*(?!\/)/g, "/");
}

export function collapseSpaces(text: string): string {
  return text.replace(/(\S) {2,}/g, "$1 ");
}

// ============================================================
// Group 4: Dash & Quote
// ============================================================

export function convertDashes(text: string): string {
  const cjkBothPattern = new RegExp(`(${CJK_CHARS_PATTERN})\\s*-{2,}\\s*(${CJK_CHARS_PATTERN})`, "g");
  const cjkLeftPattern = new RegExp(`(${CJK_CHARS_PATTERN})\\s*-{2,}\\s*([A-Za-z0-9])`, "g");
  const cjkRightPattern = new RegExp(`([A-Za-z0-9])\\s*-{2,}\\s*(${CJK_CHARS_PATTERN})`, "g");

  const replacer = (_: string, before: string, after: string) => {
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  };

  text = text.replace(cjkBothPattern, replacer);
  text = text.replace(cjkLeftPattern, replacer);
  text = text.replace(cjkRightPattern, replacer);
  return text;
}

export function fixEmdashSpacing(text: string): string {
  return text.replace(/([^\s])\s*——\s*([^\s])/g, (_, before, after) => {
    const leftSpace = CJK_CLOSING_BRACKETS.includes(before) ? "" : " ";
    const rightSpace = CJK_OPENING_BRACKETS.includes(after) ? "" : " ";
    return `${before}${leftSpace}——${rightSpace}${after}`;
  });
}

const QUOTE_STYLES: Record<QuoteStyle, { doubleOpen: string; doubleClose: string; singleOpen: string; singleClose: string }> = {
  curly: { doubleOpen: "\u201c", doubleClose: "\u201d", singleOpen: "\u2018", singleClose: "\u2019" },
  corner: { doubleOpen: "「", doubleClose: "」", singleOpen: "『", singleClose: "』" },
  guillemets: { doubleOpen: "«", doubleClose: "»", singleOpen: "‹", singleClose: "›" },
};

export function convertStraightToSmartQuotes(text: string, style: QuoteStyle): string {
  const quotes = QUOTE_STYLES[style];
  text = text.replace(/"/g, (_, offset) => {
    const before = offset > 0 ? text[offset - 1] : "";
    if (offset === 0 || /[\s([{「『《【〈]/.test(before)) {
      return quotes.doubleOpen;
    }
    return quotes.doubleClose;
  });
  text = text.replace(/(^|[\s([{「『《【〈])'([^']*?)'/g, (_, before, content) =>
    `${before}${quotes.singleOpen}${content}${quotes.singleClose}`
  );
  return text;
}

export function convertToCJKCornerQuotes(text: string): string {
  return text.replace(/\u201c([^\u201d]*[\u4e00-\u9fff][^\u201d]*)\u201d/g, "「$1」");
}

export function convertNestedCornerQuotes(text: string): string {
  return text.replace(/「([^」]*)」/g, (_, content) => {
    const converted = content.replace(/\u2018([^\u2019]*)\u2019/g, "『$1』");
    return `「${converted}」`;
  });
}

function fixQuoteSpacing(text: string, openingQuote: string, closingQuote: string): string {
  const noSpaceBefore = CJK_CLOSING_BRACKETS + CJK_TERMINAL_PUNCTUATION;
  const noSpaceAfter = CJK_OPENING_BRACKETS + CJK_TERMINAL_PUNCTUATION;

  text = text.replace(
    new RegExp(`([A-Za-z0-9${CJK_ALL}${CJK_CLOSING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)${openingQuote}`, "g"),
    (_, before) => noSpaceBefore.includes(before) ? `${before}${openingQuote}` : `${before} ${openingQuote}`
  );
  text = text.replace(
    new RegExp(`${closingQuote}([A-Za-z0-9${CJK_ALL}${CJK_OPENING_BRACKETS}${CJK_TERMINAL_PUNCTUATION}]|——)`, "g"),
    (_, after) => noSpaceAfter.includes(after) ? `${closingQuote}${after}` : `${closingQuote} ${after}`
  );
  return text;
}

export function fixDoubleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u201c", "\u201d");
}

export function fixSingleQuoteSpacing(text: string): string {
  return fixQuoteSpacing(text, "\u2018", "\u2019");
}

// ============================================================
// Group 5: Cleanup
// ============================================================

export function limitConsecutivePunctuation(text: string, limit: number): string {
  if (limit === 0) return text;
  const marks = ["！", "？", "。"];
  for (const mark of marks) {
    const escaped = mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (limit === 1) {
      text = text.replace(new RegExp(`${escaped}{2,}`, "g"), mark);
    } else if (limit === 2) {
      text = text.replace(new RegExp(`${escaped}{3,}`, "g"), mark + mark);
    }
  }
  return text;
}

export function removeTrailingSpaces(text: string): string {
  return text.replace(/ +$/gm, "");
}

// ============================================================
// Main Apply Function
// ============================================================

/**
 * Apply all enabled CJK formatting rules
 */
export function applyRules(text: string, config: CJKFormattingSettings): string {
  // Group 1: Universal
  if (config.ellipsisNormalization) {
    text = normalizeEllipsis(text);
  }

  if (containsCJK(text)) {
    // Group 2: Fullwidth Normalization
    if (config.fullwidthAlphanumeric) text = normalizeFullwidthAlphanumeric(text);
    if (config.fullwidthPunctuation) text = normalizeFullwidthPunctuation(text);
    if (config.fullwidthBrackets) text = normalizeFullwidthBrackets(text);

    // Group 4: Dash & Quote (before spacing)
    if (config.dashConversion) text = convertDashes(text);
    if (config.emdashSpacing) text = fixEmdashSpacing(text);

    // Smart quote conversion using stack-based pairing algorithm
    if (config.smartQuoteConversion) {
      if (config.quoteStyle === "curly" || config.quoteStyle === "corner") {
        let mode: "off" | "curly-everywhere" | "contextual" | "corner-for-cjk";
        if (config.cjkCornerQuotes) {
          mode = "corner-for-cjk";
        } else if (config.contextualQuotes) {
          mode = "contextual";
        } else {
          mode = "curly-everywhere";
        }
        text = applyContextualQuotes(text, mode);
      } else {
        text = convertStraightToSmartQuotes(text, config.quoteStyle);
      }
    }

    if (config.cjkNestedQuotes) text = convertNestedCornerQuotes(text);
    if (config.quoteSpacing) text = fixDoubleQuoteSpacing(text);
    if (config.singleQuoteSpacing) text = fixSingleQuoteSpacing(text);

    // Group 3: Spacing
    if (config.cjkEnglishSpacing) text = addCJKEnglishSpacing(text);
    if (config.cjkParenthesisSpacing) text = addCJKParenthesisSpacing(text);
    if (config.fullwidthParentheses) text = normalizeFullwidthParentheses(text);
    if (config.currencySpacing) text = fixCurrencySpacing(text);
    if (config.slashSpacing) text = fixSlashSpacing(text);

    // Group 5: Cleanup (CJK-specific)
    if (config.consecutivePunctuationLimit > 0) {
      text = limitConsecutivePunctuation(text, config.consecutivePunctuationLimit);
    }
  }

  // Group 5: Universal cleanup
  if (config.spaceCollapsing) text = collapseSpaces(text);
  if (config.trailingSpaceRemoval) text = removeTrailingSpaces(text);
  if (config.newlineCollapsing) text = collapseNewlines(text);

  return text.trimEnd();
}
