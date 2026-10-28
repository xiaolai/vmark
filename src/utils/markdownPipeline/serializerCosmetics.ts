/**
 * Serializer cosmetic pass — entity restoration and escape stripping.
 *
 * Purpose: remark-stringify emits defensive backslash escapes and `&#x20;`
 * entities that are correct but noisy. This pass removes them ONLY when the
 * cleaned string re-parses to the exact same mdast as the conservative
 * output, so it can never change document meaning.
 *
 * Split out of `serializer.ts` to keep both files within their size budgets.
 *
 * @coordinates-with serializer.ts — the only caller
 * @coordinates-with parser.ts — the re-parse used to verify each edit
 * @coordinates-with serializerCodeRanges.ts — where edits must not reach
 * @module utils/markdownPipeline/serializerCosmetics
 */

import { parseMarkdownToMdast } from "./parser";
import { buildCodeRanges, isInsideCodeRange } from "./serializerCodeRanges";

/**
 * Strip unnecessary backslash escapes added by remark-stringify.
 *
 * remark-stringify defensively escapes characters like $, [, *, _, `, (, )
 * in text nodes to prevent them from being parsed as markdown syntax — and,
 * with the GFM autolink-literal extension, : and @ in URL-like text (e.g.
 * inside link labels). Since these characters were already in plain text
 * (not markup) in the MDAST, the escapes are redundant and visually noisy.
 *
 * We only strip escapes that are safe — block-level triggers at line
 * start (#, -, *, >, +) are preserved to avoid creating headings/lists,
 * and the whole pass is gated on a byte-identical re-parse.
 */
const SAFE_UNESCAPE_RE = /\\([[\]$`_*!():@])/g;

/** Characters that create block-level syntax at start of line. */
const BLOCK_START_CHARS = new Set(["#", "-", "*", ">", "+"]);

/**
 * Characters `SAFE_UNESCAPE_RE` can actually produce, READ FROM THE REGEX.
 *
 * A hand-copied second list is not a derivation: editing the regex without
 * editing the copy silently narrows the guard while the comment still claims
 * it follows automatically. Parsing the character class keeps one source,
 * and `serializerCosmetics.test.ts` pins the parse itself.
 */
export const UNESCAPABLE_CHARS: ReadonlySet<string> = new Set(
  (SAFE_UNESCAPE_RE.source.match(/\(\[(.*)\]\)/)?.[1] ?? "")
    .replace(/\\(.)/g, "$1")
    .split(""),
);

/**
 * The guard that actually fires: block-start characters this pass can emit.
 *
 * DERIVED, not restated. Listing all five block-start characters implied four
 * branches that no input could reach — `SAFE_UNESCAPE_RE` never yields `#`,
 * `-`, `>` or `+` — which reads as protection that is not there. Intersecting
 * the two sets means adding a character to either one automatically extends
 * the guard, and `serializerCosmetics.test.ts` pins the current result.
 */
export const BLOCK_START_GUARD: ReadonlySet<string> = new Set(
  [...BLOCK_START_CHARS].filter((c) => UNESCAPABLE_CHARS.has(c)),
);

/** One cosmetic replacement on the serialized string: `[start, end)` becomes `replacement`. */
export interface CosmeticEdit {
  start: number;
  end: number;
  replacement: string;
}

const SPACE_ENTITY = "&#x20;";

/**
 * Collect &#x20; entities that look serializer-emitted: a single entity at a
 * line boundary, outside code, and not part of user text (which arrives
 * escaped as \&#x20;). Runs of two or more entities are left alone — turning
 * them into literal spaces could create hard breaks or indented code.
 */
function collectEntityEdits(
  markdown: string,
  ranges: Array<[number, number]>
): CosmeticEdit[] {
  const edits: CosmeticEdit[] = [];
  const re = /&#x20;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const start = m.index;
    const end = start + SPACE_ENTITY.length;
    if (isInsideCodeRange(ranges, start)) continue;
    if (markdown[start - 1] === "\\") continue;
    if (markdown.startsWith(SPACE_ENTITY, end)) continue;
    if (start >= SPACE_ENTITY.length && markdown.endsWith(SPACE_ENTITY, start)) continue;
    const atLineStart = start === 0 || markdown[start - 1] === "\n";
    const next = markdown[end];
    const atLineEnd =
      end === markdown.length ||
      next === "\n" ||
      next === "\r" ||
      // trailing space before a backslash hard break
      (next === "\\" && (markdown[end + 1] === "\n" || markdown[end + 1] === "\r"));
    if (atLineStart || atLineEnd) {
      edits.push({ start, end, replacement: " " });
    }
  }
  return edits;
}

/**
 * Collect candidate escape strips, applying the same guards as before.
 *
 * "Only whitespace before it on its line" is tracked in ONE forward pass. It
 * was a `lastIndexOf` + `slice` per escape, which walks back to the line start
 * each time — O(n²) on a long line of escapes, and every hostile inline class
 * serializes to exactly that (#1407). `\s` is the set `trimStart` removes.
 */
function collectEscapeEdits(
  markdown: string,
  ranges: Array<[number, number]>
): CosmeticEdit[] {
  const edits: CosmeticEdit[] = [];
  const re = new RegExp(SAFE_UNESCAPE_RE.source, "g");
  let scanned = 0;
  let lineStart = 0;
  let lastInk = -1; // last non-whitespace index before `scanned`
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    const offset = m.index;
    for (; scanned < offset; scanned += 1) {
      const ch = markdown[scanned];
      if (ch === "\n") lineStart = scanned + 1;
      else if (!/\s/.test(ch)) lastInk = scanned;
    }
    if (isInsideCodeRange(ranges, offset)) continue;
    const char = m[1];
    if (lastInk < lineStart && BLOCK_START_GUARD.has(char)) continue;
    edits.push({ start: offset, end: offset + 2, replacement: char });
  }
  return edits;
}

/** Apply non-overlapping, ascending edits to a string. */
function applyEdits(markdown: string, edits: CosmeticEdit[]): string {
  let out = "";
  let cursor = 0;
  for (const e of edits) {
    out += markdown.slice(cursor, e.start) + e.replacement;
    cursor = e.end;
  }
  return out + markdown.slice(cursor);
}

/**
 * Right-trim the final text child of each paragraph/heading. Serializer-
 * emitted trailing-space entities decode to spaces the next parse would trim
 * anyway; normalizing both sides keeps that long-accepted loss from forcing
 * the conservative (entity-bearing) output.
 */
function trimBlockFinalText(node: unknown): void {
  if (!node || typeof node !== "object") return;
  const n = node as { type?: string; children?: unknown[] };
  if (!Array.isArray(n.children)) return;
  for (const child of n.children) trimBlockFinalText(child);
  if ((n.type === "paragraph" || n.type === "heading") && n.children.length) {
    const last = n.children[n.children.length - 1] as { type?: string; value?: string };
    if (last.type === "text" && typeof last.value === "string") {
      last.value = last.value.replace(/[ \t]+$/, "");
    }
  }
}

/** Parse markdown and return a normalized, comparable JSON form (or null). */
function normalizedParse(markdown: string): string | null {
  try {
    const tree = parseMarkdownToMdast(markdown);
    const clone = JSON.parse(
      JSON.stringify(tree, (key, value) => (key === "position" ? undefined : value))
    ) as unknown;
    trimBlockFinalText(clone);
    return JSON.stringify(clone);
  } catch {
    return null;
  }
}

/**
 * Size above which the cosmetic pass is skipped and the CONSERVATIVE output
 * is kept.
 *
 * This is a deliberate, measured trade-off, not an arbitrary number.
 * Verification re-parses the whole document, and that cost is what forces a
 * ceiling (measured on an M-series Mac, jsdom tier):
 *
 * | document | verified pass |
 * |----------|---------------|
 * | 100 KB   | ~0.25 s       |
 * | 300 KB   | ~0.73 s       |
 * | 1 MB     | ~3.0 s        |
 * | 5 MB     | ~22 s         |
 *
 * Removing the ceiling entirely — which is the theoretically clean answer,
 * since canonical output should not depend on document length — makes every
 * save of a 5 MB document freeze the editor for 22 seconds. That is a worse
 * defect than cosmetic inconsistency.
 *
 * What the ceiling costs: above it, output keeps serializer-emitted `&#x20;`
 * entities and defensive escapes. That output is still CORRECT markdown and
 * still round-trip stable — it is only less tidy. `serializerCosmetics.test.ts`
 * pins both branches, so the boundary is tested behaviour rather than an
 * accident.
 */
export const COSMETIC_VERIFY_LIMIT = 300_000;

/**
 * Apply the cosmetic pass (entity restoration + escape stripping) only if the
 * result re-parses to the exact same mdast as the conservative output. Falls
 * back to entity-edits-only, then to the conservative string. This makes
 * "the cosmetic pass never changes meaning" a structural invariant instead of
 * a per-character guess.
 *
 * Returns the output plus the ascending, non-overlapping edits that turn
 * `markdown` into it (none when it changed nothing).
 */
export function applyCosmeticPassWithEdits(markdown: string): { text: string; edits: readonly CosmeticEdit[] } {
  const unchanged = { text: markdown, edits: [] };
  if (markdown.length > COSMETIC_VERIFY_LIMIT) return unchanged;
  const ranges = buildCodeRanges(markdown);
  const entityEdits = collectEntityEdits(markdown, ranges);
  const escapeEdits = collectEscapeEdits(markdown, ranges);
  if (!entityEdits.length && !escapeEdits.length) return unchanged;

  const reference = normalizedParse(markdown);
  if (reference === null) return unchanged;

  const allEdits = [...entityEdits, ...escapeEdits].sort((a, b) => a.start - b.start);
  const full = applyEdits(markdown, allEdits);
  if (normalizedParse(full) === reference) return { text: full, edits: allEdits };

  if (escapeEdits.length && entityEdits.length) {
    const entityOnly = applyEdits(markdown, entityEdits);
    if (normalizedParse(entityOnly) === reference) return { text: entityOnly, edits: entityEdits };
  }
  return unchanged;
}
