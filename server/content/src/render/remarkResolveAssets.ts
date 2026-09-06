/**
 * Rewrite local image/media URLs to the KB's served asset route.
 *
 * A note's `![caption](picture.png)` is relative to the note, so the browser
 * resolves it under `/note/…` — a route that serves only indexed markdown, so
 * the image 404s even with a valid session (audit 20260906, MCP-C03).
 *
 * Done in mdast rather than over the rendered HTML: the URL is a field on the
 * node here, so there is no HTML parsing or regex rewriting of `src`
 * attributes, and a URL that happens to appear in prose or a code block is not
 * touched.
 *
 * @coordinates-with server/assetRoute.ts — builds the replacement URL
 * @coordinates-with renderMarkdown.ts — installs this plugin
 * @module render/remarkResolveAssets
 */
import type { Root } from "mdast";
import { isLocalAssetUrl } from "../server/assetRoute";

interface Options {
  /** Undefined in standalone rendering: leave every URL exactly as written. */
  resolve?: (url: string) => string;
}

/** Visit every mdast node, depth-first. */
function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  visit(record);
  const children = record.children;
  if (Array.isArray(children)) {
    for (const child of children) walk(child, visit);
  }
}

export function remarkResolveAssets(options: Options = {}) {
  const { resolve } = options;
  return (tree: Root): void => {
    if (!resolve) return;
    walk(tree, (node) => {
      // `image` covers markdown syntax; `imageReference` has already been
      // resolved to an `image` by remarkResolveReferences upstream.
      if (node.type !== "image") return;
      const url = node.url;
      if (typeof url !== "string" || !isLocalAssetUrl(url)) return;
      node.url = resolve(url);
    });
  };
}
