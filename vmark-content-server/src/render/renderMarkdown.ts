/**
 * renderMarkdown — headless markdown → sanitized HTML (ADR-4).
 *
 * Purpose: Render a workspace markdown file to HTML in pure Node, reusing
 * VMark's alias-free remark plugins (via the `@vmark/markdown-plugins`
 * boundary) so the served knowledge base matches the editor's semantics. Math
 * renders server-side (KaTeX); Mermaid/Markmap are emitted as client-rendered
 * placeholders (the served page ships their browser bundles, mirroring the
 * editor). Output is sanitized with DOMPurify over a jsdom window — the Node
 * DOM the review (D3.3) flagged as required.
 *
 * Pipeline: remark-parse → gfm → math → frontmatter → {wikiLinks, customInline,
 *   detailsBlock, resolveReferences, alerts} → remark-rehype (custom handlers)
 *   → rehype-katex → rehype-stringify → DOMPurify(jsdom).
 *
 * @module render/renderMarkdown
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import remarkRehype, { type Options as RehypeOptions } from "remark-rehype";
import rehypeKatex from "rehype-katex";
import rehypeStringify from "rehype-stringify";
import { h } from "hastscript";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import {
  remarkWikiLinks,
  remarkCustomInline,
  remarkDetailsBlock,
  remarkResolveReferences,
} from "@vmark/markdown-plugins";
import { remarkAlerts, type AlertNode } from "./remarkAlerts";

/** How a wiki-link target resolves to a served URL. */
export interface WikiResolution {
  href: string;
  /** False → render as a "missing" link (distinct styling, still navigable). */
  exists: boolean;
}

export interface RenderOptions {
  /**
   * Resolve a `[[target]]` (sans alias/anchor) to a served href. Defaults to a
   * non-resolving stub used in standalone rendering/tests.
   */
  resolveWikiLink?: (target: string) => WikiResolution;
}

const DEFAULT_RESOLVE = (target: string): WikiResolution => ({
  href: `#${encodeURIComponent(target)}`,
  exists: false,
});

type Handlers = NonNullable<RehypeOptions["handlers"]>;
// mdast-util-to-hast's State; `.all()` maps a parent's children to hast.
type HastState = { all: (node: unknown) => never[] };

/** mdast→hast handlers for VMark's custom inline/block nodes. */
function buildHandlers(resolve: (t: string) => WikiResolution): Handlers {
  const all = (state: unknown, node: unknown) => (state as HastState).all(node);
  return {
    wikiLink(_state: unknown, node: unknown) {
      const n = node as { value: string; alias?: string };
      const [target, anchor] = n.value.split("#");
      const res = resolve(target);
      const href = anchor ? `${res.href}#${encodeURIComponent(anchor)}` : res.href;
      return h(
        "a",
        {
          className: res.exists ? ["wiki-link"] : ["wiki-link", "wiki-link--missing"],
          href,
          "data-target": n.value,
        },
        [{ type: "text", value: n.alias ?? n.value }]
      );
    },
    highlight: (state: unknown, node: unknown) => h("mark", all(state, node)),
    subscript: (state: unknown, node: unknown) => h("sub", all(state, node)),
    superscript: (state: unknown, node: unknown) => h("sup", all(state, node)),
    underline: (state: unknown, node: unknown) => h("u", all(state, node)),
    details(state: unknown, node: unknown) {
      const n = node as { summary?: string; open?: boolean };
      const summary = h("summary", [{ type: "text", value: n.summary ?? "Details" }]);
      return h("details", n.open ? { open: true } : {}, [summary, ...all(state, node)]);
    },
    alert(state: unknown, node: unknown) {
      const n = node as AlertNode;
      return h(
        "div",
        { className: ["markdown-alert", `markdown-alert-${n.kind}`], "data-kind": n.kind },
        all(state, node)
      );
    },
    // (grill L5) no `toc` handler — remarkTocBlock isn't applied in this
    // pipeline, so a `toc` MDAST node is never produced.
  } as Handlers;
}

/** Lazily-created shared sanitizer over a single jsdom window. */
let purifier: ReturnType<typeof createDOMPurify> | null = null;
function getPurifier(): ReturnType<typeof createDOMPurify> {
  if (purifier) return purifier;
  const window = new JSDOM("").window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  purifier = createDOMPurify(window as any);
  return purifier;
}

/** Sanitize rendered HTML, allowing the tags/attrs our handlers + KaTeX emit. */
export function sanitizeHtml(html: string): string {
  return getPurifier().sanitize(html, {
    // grill M1 — KaTeX emits HTML + MathML; the full SVG profile is not needed
    // and widens the mXSS surface. Mermaid/Markmap render client-side from a
    // trusted bundle, not through this note sanitizer.
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ["data-target", "data-kind", "data-toc", "open"],
    // KaTeX relies on inline styles; DOMPurify still scrubs dangerous values.
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover"],
  });
}

/**
 * Render markdown to sanitized HTML using VMark's pipeline semantics.
 */
export async function renderMarkdown(
  markdown: string,
  options: RenderOptions = {}
): Promise<string> {
  const resolve = options.resolveWikiLink ?? DEFAULT_RESOLVE;
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkCustomInline)
    .use(remarkDetailsBlock)
    .use(remarkResolveReferences)
    .use(remarkAlerts)
    .use(remarkRehype, {
      allowDangerousHtml: true,
      handlers: buildHandlers(resolve),
    })
    .use(rehypeKatex)
    .use(rehypeStringify, { allowDangerousHtml: true });

  const file = await processor.process(markdown);
  return sanitizeHtml(String(file));
}
