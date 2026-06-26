/**
 * Node-safe markdown-pipeline entry (ADR-4, content-server boundary).
 *
 * Purpose: Re-export the alias-free, DOM-free remark plugins + their MDAST node
 * types so they can be consumed from a pure-Node context (the
 * `vmark-content-server` package) WITHOUT dragging in editor-only code.
 *
 * Why this file exists:
 *   - `plugins/index.ts` (the barrel) transitively imports `../parser` and
 *     `../serializer`, which pull `@/utils/perfLog` (a `@/`-aliased, editor
 *     module). That alias does not resolve in a standalone Node package.
 *   - Each individual plugin file under `plugins/` is alias-free and imports
 *     only npm packages + sibling plugins + `./types`. Re-exporting them
 *     directly keeps the Node boundary clean.
 *
 * INVARIANT: Everything re-exported here MUST remain free of `@/` aliases, DOM
 * globals, and editor/ProseMirror imports. A Node-only smoke test in
 * `vmark-content-server` guards this.
 *
 * @module utils/markdownPipeline/nodeSafe
 */

export { remarkWikiLinks } from "./plugins/wikiLinks";
export { remarkCustomInline } from "./plugins/customInline";
export { remarkDetailsBlock } from "./plugins/detailsBlock";
export { remarkTocBlock } from "./plugins/tocBlock";
export { remarkResolveReferences } from "./plugins/resolveReferences";

export type {
  WikiLink,
  Highlight,
  Subscript,
  Superscript,
  Underline,
  Details,
  Toc,
} from "./types";
