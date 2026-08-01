/**
 * Purpose: THE fixture manifest for parser conformance — one typed list with
 * stable IDs, from which every matrix is derived.
 *
 * The plan used "corpus", "matrix", "extension" and "expected node type" without
 * enumerating any of them, so it was unclear whether the corpus meant the
 * characterisation files, the parity fixtures, or something new. Four
 * vocabularies for one idea is how a gate ends up covering less than it claims.
 * This is the only list; `parserConformance.test.ts` derives its matrix from it,
 * and a fixture that is present here but exercised by nothing fails.
 *
 * Key decisions:
 *   - IDs ARE STABLE. Delta declarations key on them, so renaming a fixture
 *     orphans its declaration — which the gate reports rather than ignores.
 *   - CONTENT CLASS is what the matrix slices on: a class with no fixture is a
 *     coverage hole the gate can name, rather than one nobody notices.
 *   - The domain is `canonicalEditorText` — LF, BOM-free. CRLF belongs to
 *     WI-1.9, which exercises it through the real ingress; putting it here
 *     would only measure harness skew (decision D3).
 *
 * Every member of `PREFIX_STRIPPING_CONTAINERS` has a fixture here, so the
 * set's "measured, not assumed" claim is backed rather than asserted.
 *
 * @coordinates-with parserConformance.test.ts — derives every matrix from this
 * @coordinates-with semanticProjection.ts — how trees are compared
 * @module utils/markdownPipeline/conformance/fixtures
 */

/** What a fixture is exercising. Every class must have at least one fixture. */
export const CONTENT_CLASSES = [
  "commonmark",
  "gfm",
  "frontmatter",
  "math",
  "details",
  "alerts",
  "toc",
  "wiki-links",
  "custom-inline",
  "unicode",
  "malformed",
  "nesting",
] as const;

export type ContentClass = (typeof CONTENT_CLASSES)[number];

/** Whether a fixture's nodes can carry verifiable source offsets. */
export type PositionExpectation =
  /** Every node has a canonical range; offsets are round-trip checked. */
  | "all-canonical"
  /** Contains synthesised nodes — offsets checked only for trusted ones. */
  | "partial-synthesised";

export interface ConformanceFixture {
  /** Stable. Delta declarations key on it. */
  id: string;
  contentClass: ContentClass;
  /** `canonicalEditorText`: LF, no BOM. */
  markdown: string;
  positions: PositionExpectation;
  /** Why this input is interesting — a fixture without one is a guess. */
  note: string;
}

const f = (
  id: string,
  contentClass: ContentClass,
  markdown: string,
  positions: PositionExpectation,
  note: string
): ConformanceFixture => ({ id, contentClass, markdown, positions, note });

export const FIXTURES: readonly ConformanceFixture[] = [
  // --- CommonMark baseline ---
  f("cm-paragraph", "commonmark", "Just a paragraph.\n", "all-canonical",
    "The simplest possible document — if this diverges, nothing else matters."),
  f("cm-atx-heading", "commonmark", "# H1\n\n## H2\n", "all-canonical",
    "ATX headings at two levels."),
  f("cm-setext", "commonmark", "Title\n=====\n\nSub\n---\n", "all-canonical",
    "Setext headings, which `remarkDisableSetextHeadings` can suppress — the " +
    "delta between document and source-position modes when the repair fires."),
  f("cm-bare-list-marker", "commonmark", "text\n  -\n", "all-canonical",
    "The exact shape the setext repair exists for: an INDENTED lone list " +
    "marker that CommonMark reads as a setext underline."),
  f("cm-code-fence", "commonmark", "```js\nconst x = 1;\n```\n", "all-canonical",
    "Fenced code — content must not be parsed as markdown."),
  f("cm-blockquote", "commonmark", "> quoted\n> more\n", "all-canonical",
    "Blockquote, a container whose children carry their own ranges."),
  f("conf-footnote-continuation", "gfm", "[^a]: first line\n    second line\n\nBody.\n",
    "all-canonical",
    "A footnote definition strips the four-space continuation indent from its " +
    "descendants exactly as a blockquote strips `> `, so it belongs in " +
    "PREFIX_STRIPPING_CONTAINERS. Nothing exercised it, so the set claimed to " +
    "be 'measured, not assumed' while being incomplete — a consumer honouring " +
    "the documented set would still have corrupted a footnote body."),

  // --- GFM ---
  f("gfm-table", "gfm", "| a | b |\n| - | - |\n| 1 | 2 |\n", "all-canonical",
    "Tables, with alignment metadata that the projection must not discard."),
  f("gfm-task-list", "gfm", "- [ ] todo\n- [x] done\n", "all-canonical",
    "Task list items carry a `checked` attribute — a semantic value, not style."),
  f("gfm-strikethrough", "gfm", "~~struck~~ but not ~single~\n", "partial-synthesised",
    "THE tilde case. `singleTilde: false` in every mode, so `~x~` is subscript " +
    "and `~~x~~` is deletion — the two must never swap between dialects. " +
    "MEASURED: `~single~` becomes a positionless `subscript` node, so this is " +
    "NOT all-canonical; classifying it so was an assumption until the " +
    "zero-untrusted assertion below caught it."),
  f("gfm-autolink", "gfm", "Visit https://example.com now.\n", "all-canonical",
    "Bare autolink, synthesised by GFM from a text scan."),

  // --- Extensions ---
  f("frontmatter-yaml", "frontmatter", "---\ntitle: T\n---\n\nBody.\n", "all-canonical",
    "Frontmatter is conditional in document mode, unconditional in " +
    "source-position — the clearest conditional-loading delta."),
  f("math-inline", "math", "Euler: $e^{i\\pi}+1=0$\n", "all-canonical",
    "Inline math, conditional on a `$` in document mode."),
  f("math-block", "math", "$$\n\\int_0^1 x\\,dx\n$$\n", "all-canonical",
    "Block math: a fenced construct whose body must not be parsed as markdown."),
  f("details-simple", "details",
    "<details><summary>S</summary>\n\nBody **bold**.\n\n</details>\n",
    "partial-synthesised",
    "The details node is synthesised and carries no position. CORRECTED: its " +
    "descendants DO carry correct absolute offsets — the claim that a " +
    "re-parsed body is offset-local was inherited from a plan review and " +
    "measured false (see positionTrust.ts)."),
  f("toc-block", "toc", "# H\n\n[toc]\n", "all-canonical",
    "TOC is synthesised but — measured, not assumed — DOES carry a position."),
  f("wiki-link", "wiki-links", "See [[Another Note]] please.\n", "partial-synthesised",
    "Wiki links are synthesised from a text scan and carry no position."),
  f("custom-inline-all", "custom-inline",
    "==hi== and ~sub~ and ^sup^ and ++under++\n", "partial-synthesised",
    "All four custom inline marks; none carry positions."),
  f("alert-note", "alerts", "> [!NOTE]\n> Something.\n", "all-canonical",
    "GitHub alert syntax, which is a blockquote until a renderer reads it."),

  // --- Unicode ---
  f("unicode-cjk", "unicode", "中文段落，带**粗体**。\n", "all-canonical",
    "CJK: offsets are UTF-16 code units, and CJK is BMP so one unit each."),
  f("unicode-surrogates", "unicode", "Emoji 👨‍👩‍👧‍👦 and 𝕏 in text.\n", "all-canonical",
    "Astral-plane characters are TWO UTF-16 units. A range must never split a " +
    "surrogate pair — the check that catches code-point/unit confusion."),
  f("unicode-combining", "unicode", "é vs é look alike.\n", "all-canonical",
    "Combining mark vs precomposed: same rendering, different lengths."),
  f("unicode-rtl", "unicode", "Hebrew שלום and back.\n", "all-canonical",
    "RTL text — logical order is what offsets address, not visual order."),

  // --- Malformed ---
  f("malformed-unterminated-fence", "malformed", "```js\nconst x = 1;\n", "all-canonical",
    "Unterminated fence: the parser must not hang or drop the tail."),
  f("malformed-unterminated-math", "malformed", "$$\n\\int_0^1\n", "all-canonical",
    "Unterminated block math."),
  f("malformed-unclosed-details", "malformed",
    "<details><summary>S</summary>\n\nBody.\n", "all-canonical",
    "Unclosed `<details>`. MEASURED: no details node is synthesised at all — " +
    "the opening tag stays an html node and the body stays a paragraph, so " +
    "every node keeps a canonical range. Classifying this as synthesised was " +
    "an assumption the gate rejected."),
  f("malformed-frontmatter", "malformed", "---\nnot: [valid\n---\n\nBody.\n", "all-canonical",
    "Frontmatter whose YAML does not parse; the block is still delimited."),
  f("malformed-unknown-alert", "malformed", "> [!NOPE]\n> Body.\n", "all-canonical",
    "An alert type nothing recognises stays an ordinary blockquote."),

  // --- Nesting ---
  f("nesting-details-in-list", "nesting",
    "- item\n\n  <details><summary>S</summary>\n\n  Inner.\n\n  </details>\n",
    "partial-synthesised",
    "A details block inside a list item — container nesting across a re-parse."),
  f("nesting-deep-quote-list", "nesting", "> - a\n>   - b\n>     - c\n", "all-canonical",
    "Three levels of list inside a blockquote."),
  f("nesting-code-in-quote", "nesting", "> ```js\n> const x = 1;\n> ```\n", "all-canonical",
    "Fenced code inside a blockquote — the fence must not leak."),
] as const;

/** Fixtures for one content class. */
export function fixturesOfClass(contentClass: ContentClass): ConformanceFixture[] {
  return FIXTURES.filter((fixture) => fixture.contentClass === contentClass);
}

