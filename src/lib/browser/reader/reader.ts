/**
 * Generic page reader — DOM → clean Markdown (WI-2.4, `browser.read`).
 *
 * Purpose: extract the main readable content of an arbitrary web page and render
 * it as Markdown, discarding navigation/aside/footer boilerplate. Leaf-pure:
 * given an HTML string and the page URL it parses with `DOMParser`, selects the
 * main-content container with a Readability-style density heuristic, and
 * serializes it with a Turndown-style converter. Site-specific readers (WI-3.x)
 * harden this against a fixture corpus.
 *
 * The page is untrusted input, so text nodes are Markdown-escaped: a paragraph
 * that literally reads "# Sale" must not turn into a heading in the user's
 * document. Code spans/blocks are exempt — they are literal by construction.
 *
 * Runs in the webview/frontend against the page's captured `outerHTML` (fetched
 * by the driver via eval) — never in Rust — so `DOMParser`/DOM APIs are present.
 *
 * @module lib/browser/reader/reader
 */

/** The extracted, reader-mode view of a page. */
export interface ReaderResult {
  /** Page/article title (article `<h1>` preferred, else `<title>` sans site suffix). */
  title: string;
  /** Author byline, when detectable. */
  byline: string | null;
  /** The page URL the content was read from (relative URLs resolve against it). */
  url: string;
  /** Main content rendered as Markdown. */
  markdown: string;
  /** Approximate character length of the extracted plain text. */
  textLength: number;
}

// --- DOM → Markdown ---------------------------------------------------------

const HEADINGS: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const DROP = new Set(["script", "style", "noscript", "template", "svg", "iframe", "form"]);

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/** Collapse internal whitespace and trim — the reader emits one-line fields. */
function normalizeWs(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Longest run of consecutive backticks in `s` (0 if none) — used to pick a code
 *  span/fence delimiter that the content cannot terminate early. */
function longestBacktickRun(s: string): number {
  const runs = s.match(/`+/g);
  return runs ? Math.max(...runs.map((r) => r.length)) : 0;
}

/** A markdown link/image destination. Wrap in angle brackets when it contains
 *  whitespace or parentheses, which would otherwise truncate the destination
 *  (`[t](http://x/a))` drops the trailing `)` and leaks stray text). The angle form
 *  forbids `<`/`>`/newline, which `resolveUrl` (a parsed `URL.href`) has already
 *  percent-encoded away. */
function mdDestination(url: string): string {
  return /[()\s]/.test(url) ? `<${url}>` : url;
}

function serializeChildren(el: Element, baseUrl: string): string {
  let out = "";
  el.childNodes.forEach((node) => {
    out += serializeNode(node, baseUrl);
  });
  return out;
}

function listItems(el: Element): Element[] {
  return Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li");
}

/**
 * Escape Markdown-significant characters in *page text*.
 *
 * The page is untrusted input: a paragraph that literally reads "# Sale" or
 * "- item" must not become a heading or a list in the document the user gets. Only
 * text nodes pass through here — code spans and fenced blocks are emitted from
 * `textContent` verbatim (they are literal by construction), and the structural
 * markers this module emits itself are added after escaping.
 */
function escapeText(text: string): string {
  return (
    text
      // Backslash first, or it would escape the escapes added below.
      .replace(/\\/g, "\\\\")
      // `<` is escaped too: a decoded `<img onerror=…>` in page text would otherwise
      // survive as a raw HTML node in the emitted markdown.
      .replace(/([`*_[\]<])/g, "\\$1")
      // Block-level markers only bite at the start of a line/text run.
      .replace(/^(\s*)([-+>#])/, "$1\\$2")
      .replace(/^(\s*)(\d+)\./, "$1$2\\.")
  );
}

function serializeNode(node: Node, baseUrl: string): string {
  if (node.nodeType === 3 /* TEXT_NODE */) {
    return escapeText((node.textContent ?? "").replace(/\s+/g, " "));
  }
  if (node.nodeType !== 1 /* ELEMENT_NODE */) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (DROP.has(tag)) return "";

  const heading = HEADINGS[tag];
  if (heading) return `\n\n${"#".repeat(heading)} ${serializeChildren(el, baseUrl).trim()}\n\n`;

  switch (tag) {
    case "p":
      return `\n\n${serializeChildren(el, baseUrl).trim()}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "strong":
    case "b": {
      const inner = serializeChildren(el, baseUrl).trim();
      return inner ? `**${inner}**` : "";
    }
    case "em":
    case "i": {
      const inner = serializeChildren(el, baseUrl).trim();
      return inner ? `*${inner}*` : "";
    }
    case "code": {
      // Choose a fence longer than the longest backtick run so a backtick in the
      // content cannot terminate the span early. Pad when it borders a backtick.
      const code = el.textContent ?? "";
      const fence = "`".repeat(longestBacktickRun(code) + 1);
      const pad = code.startsWith("`") || code.endsWith("`") ? " " : "";
      return `${fence}${pad}${code}${pad}${fence}`;
    }
    case "pre": {
      // Same rule for a fenced block: the fence must be longer than any ``` inside,
      // or hostile content could close the fence and forge document structure.
      const body = (el.textContent ?? "").replace(/\n+$/, "");
      const fence = "`".repeat(Math.max(3, longestBacktickRun(body) + 1));
      return `\n\n${fence}\n${body}\n${fence}\n\n`;
    }
    case "a": {
      const href = el.getAttribute("href");
      const text = serializeChildren(el, baseUrl).trim();
      return href ? `[${text}](${mdDestination(resolveUrl(href, baseUrl))})` : text;
    }
    case "img": {
      const src = el.getAttribute("src");
      if (!src) return "";
      const alt = escapeText(normalizeWs(el.getAttribute("alt") ?? ""));
      return `![${alt}](${mdDestination(resolveUrl(src, baseUrl))})`;
    }
    case "ul":
      return `\n\n${listItems(el)
        .map((li) => `- ${serializeChildren(li, baseUrl).trim()}`)
        .join("\n")}\n\n`;
    case "ol":
      return `\n\n${listItems(el)
        .map((li, i) => `${i + 1}. ${serializeChildren(li, baseUrl).trim()}`)
        .join("\n")}\n\n`;
    case "blockquote": {
      const inner = serializeChildren(el, baseUrl).trim();
      const quoted = inner
        .split("\n")
        .map((line) => (line ? `> ${line}` : ">"))
        .join("\n");
      return `\n\n${quoted}\n\n`;
    }
    default:
      return serializeChildren(el, baseUrl);
  }
}

function toMarkdown(el: Element, baseUrl: string): string {
  return serializeChildren(el, baseUrl)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// --- Extraction -------------------------------------------------------------

const NOISE = "nav, aside, footer, header, form, iframe, svg, script, style, noscript";

/** Text length of a container's own paragraph content — the density score. */
function contentScore(el: Element): number {
  let score = 0;
  el.querySelectorAll("p").forEach((p) => {
    score += (p.textContent ?? "").trim().length;
  });
  return score;
}

/** Select the main-content element: a non-trivial `<article>`/`<main>` wins;
 *  otherwise the highest-density container; else `<body>`. */
function selectMainContent(doc: Document): Element | null {
  const semantic = doc.querySelector("article") ?? doc.querySelector("main");
  if (semantic && contentScore(semantic) > 0) return semantic;

  let best: Element | null = null;
  let bestScore = 0;
  doc.querySelectorAll("div, section, article, main").forEach((el) => {
    const score = contentScore(el);
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  });
  return best ?? doc.body ?? null;
}

/** Strip a trailing " — Site", " | Site", etc. from a `<title>`. */
function stripSiteSuffix(title: string): string {
  const parts = title.split(/\s+[|—–-]\s+/);
  return (parts[0] ?? title).trim();
}

function extractTitle(doc: Document, main: Element | null): string {
  const h1 = main?.querySelector("h1") ?? doc.querySelector("h1");
  if (h1?.textContent?.trim()) return h1.textContent.trim();
  const title = doc.querySelector("title")?.textContent?.trim();
  return title ? stripSiteSuffix(title) : "";
}

function extractByline(scope: Element | Document): string | null {
  const el =
    scope.querySelector("[rel=author]") ??
    scope.querySelector("[itemprop=author]") ??
    scope.querySelector(".byline, .author");
  const text = el?.textContent?.trim();
  return text || null;
}

/**
 * Read a page's HTML into a reader-mode Markdown view. Never throws on malformed
 * or empty input — returns an empty result instead.
 */
export function readPage(html: string, url: string): ReaderResult {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  // Byline can live in noise regions (a header author link) — read it first.
  const byline = extractByline(doc);
  doc.querySelectorAll(NOISE).forEach((el) => el.remove());

  const main = selectMainContent(doc);
  const title = extractTitle(doc, main);
  const markdown = main ? toMarkdown(main, url) : "";
  const textLength = (main?.textContent ?? "").replace(/\s+/g, " ").trim().length;
  return { title, byline, url, markdown, textLength };
}
