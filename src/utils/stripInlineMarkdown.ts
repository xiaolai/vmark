/**
 * stripInlineMarkdown
 *
 * Purpose: turn one line of inline markdown into the text a reader sees, for
 * surfaces that display heading text as a LABEL rather than rendering it.
 *
 * Why it exists: the outline pane reads headings straight out of the markdown
 * source, so `## The **bold** one` was listed with its asterisks — as were code
 * spans, links and wiki links, each shown as its own syntax rather than its
 * text. The in-document TOC block never had this: it reads a ProseMirror doc,
 * whose `textContent` is already plain.
 *
 * Scope is deliberately INLINE and deliberately small. It does not render
 * markdown — the pipeline does that, and running it per keystroke for a label
 * would be absurd — and it does not touch math or HTML, because a heading may
 * be ABOUT a `<div>` or an equation and deleting either loses real text.
 *
 * @coordinates-with components/Sidebar/outlineUtils.ts — the one caller today
 * @module utils/stripInlineMarkdown
 */

/** Code spans, whose contents must survive verbatim. */
const CODE_SPAN = /(`+)([\s\S]*?)\1(?!`)/g;

/** Markers CommonMark lets a backslash escape. */
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!~=|<>])/g;

/**
 * Private-use sentinels. Code spans and escaped markers are parked behind these
 * while the rest of the line is stripped, then restored.
 *
 * Written as `\uXXXX` escapes rather than as raw bytes, for the reason
 * `pnpm lint:no-nul-bytes` exists: a stray control character in a source file
 * makes the file invisible to grep, silently.
 */
const PARK_OPEN = "\uE000";
const PARK_CLOSE = "\uE001";

const park = (kind: string, index: number) => `${PARK_OPEN}${kind}${index}${PARK_CLOSE}`;
const parked = (kind: string) => new RegExp(`${PARK_OPEN}${kind}(\\d+)${PARK_CLOSE}`, "g");

/**
 * Does this emphasis span hold anything but more of its own marker?
 *
 * `****` and a 200-character run of asterisks are literal text in CommonMark,
 * not empty emphasis. Without this the single-marker rule chews such a run
 * three characters at a time.
 */
const hasContent = (inner: string, marker: string) => inner.split(marker).join("").length > 0;

/** Unwrap a paired marker, leaving it alone when it wraps nothing real. */
function unwrapPairs(input: string, pattern: RegExp, marker?: string): string {
  return input.replace(pattern, (match: string, ...groups: unknown[]) => {
    // Delimiter-captured patterns pass (delim, inner); fixed-marker ones pass
    // only (inner). `groups` also carries offset and source, hence the slice.
    const captured = groups.slice(0, groups.length - 2).map(String);
    const inner = captured[captured.length - 1] ?? "";
    const ch = marker ?? (captured[0]?.[0] ?? "");
    return hasContent(inner, ch) ? inner : match;
  });
}

/**
 * Strip a line whose code spans have already been parked.
 *
 * Order matters. Images before links, or `![alt](src)` loses its `!` and keeps
 * a stray bang; links before emphasis, or a URL containing `_` reads as
 * italics; longer marker runs before shorter ones, or `***x***` sheds one
 * marker and keeps two.
 */
function stripSyntax(input: string): string {
  const escapes: string[] = [];
  let s = input.replace(ESCAPABLE, (_match, ch: string) => {
    escapes.push(ch);
    return park("e", escapes.length - 1);
  });

  s = s
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|]*\|)?([^\]|]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // `(?=\S)` before and `\S` at the end are CommonMark's flanking rule in
  // miniature: a run only opens before non-space and only closes after it,
  // which is what keeps `2 ** 3` and a dangling `**` as literal text.
  s = unwrapPairs(s, /(\*\*\*|___)(?=\S)([\s\S]*?\S)\1/g);
  s = unwrapPairs(s, /(\*\*|__)(?=\S)([\s\S]*?\S)\1/g);
  s = unwrapPairs(s, /\*(?=\S)([\s\S]*?\S)\*/g, "*");
  // Underscore emphasis is intraword-safe, so `snake_case_name` survives.
  s = unwrapPairs(s, /(?<![\p{L}\p{N}_])_(?=\S)([\s\S]*?\S)_(?![\p{L}\p{N}_])/gu, "_");
  s = unwrapPairs(s, /~~(?=\S)([\s\S]*?\S)~~/g, "~");
  s = unwrapPairs(s, /==(?=\S)([\s\S]*?\S)==/g, "=");

  return s.replace(parked("e"), (_match, i: string) => escapes[Number(i)] ?? "");
}

/**
 * Render one line of inline markdown as plain text.
 *
 * Unmatched markers are left exactly as written, which is what CommonMark does
 * with them too — a heading reading `2 ** 3 is not bold` says so in the pane.
 */
export function stripInlineMarkdown(text: string): string {
  // Parked rather than split around, because emphasis may STRADDLE a code span:
  // `**bold with \`code\`**` has its opening and closing markers in different
  // segments, so stripping each segment on its own leaves both behind.
  const spans: string[] = [];
  const masked = text.replace(CODE_SPAN, (_match, _ticks: string, inner: string) => {
    spans.push(inner);
    return park("c", spans.length - 1);
  });

  return stripSyntax(masked).replace(parked("c"), (_match, i: string) => spans[Number(i)] ?? "");
}
