/**
 * Purpose: the `<details>` body parser — a SELF-CONTAINED default, plus an
 * injection seam.
 *
 * The body dialect deliberately EXCLUDES `remarkDetailsBlock`: that is what
 * stops a body parser needing a body parser. Nested `<details>` are handled by
 * the outer pass's depth tracking (WI-3.1). Because it excludes that plugin,
 * the chain can be built here from leaf imports without touching the document
 * chain — so there is no cycle, and no need for anyone to import `dialect.ts`
 * to make the plugin work.
 *
 * THE DEFAULT IS NOT OPTIONAL, and that is the correction. An earlier version
 * had only the seam and threw "not wired" unless `dialect.ts` had been
 * imported for its side effect. Two registrants do not import it — the Node
 * content server (`server/content/src/render/renderMarkdown.ts`) and
 * `serializer.ts` — so a compact `<details><summary>S</summary>body</details>`
 * threw in production. A plugin that only works when an unrelated module
 * happens to be loaded is not wired, it is booby-trapped.
 *
 * The list below is checked against `dialectDescriptors`' `details-body`
 * membership by `dialect.test.ts`, so the default cannot drift from the table
 * that documents it.
 *
 * @coordinates-with dialectDescriptors.ts — the declared details-body membership
 * @coordinates-with dialect.test.ts — the drift gate between the two
 * @coordinates-with detailsBlock.ts — the consumer
 * @module utils/markdownPipeline/plugins/detailsBodyParser
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import { remarkDepthLimit } from "../parser/remarkPlugins";
import { remarkCustomInline } from "./customInline";
import { remarkResolveReferences } from "./resolveReferences";
import { remarkWikiLinks } from "./wikiLinks";

/** Processor shape the plugin needs — parse then run, nothing more. */
export interface DetailsBodyProcessor {
  parse(doc: string): unknown;
  runSync(tree: unknown): unknown;
}

let detailsBodyParser: (() => DetailsBodyProcessor) | null = null;
let memoized: DetailsBodyProcessor | null = null;

/** Wire the body parser. Called once by `dialect.ts` at module init. */
export function setDetailsBodyParser(factory: () => DetailsBodyProcessor): void {
  detailsBodyParser = factory;
  memoized = null; // a new wiring invalidates the old processor
}

/**
 * Build the details-body chain from leaf plugins.
 *
 * NOT `remarkDetailsBlock` — the recursion guard. Kept in descriptor ORDER so
 * the drift gate can compare it to the table position by position.
 */
function buildDefaultBodyProcessor(): DetailsBodyProcessor {
  return unified()
    .use(remarkParse)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkMath)
    .use(remarkDepthLimit)
    .use(remarkFrontmatter, ["yaml"])
    .use(remarkWikiLinks)
    .use(remarkCustomInline)
    .use(remarkResolveReferences) as unknown as DetailsBodyProcessor;
}

/**
 * The wired body parser, built once.
 *
 * LAZY THEN MEMOIZED. Lazy because `dialect.ts` wires at module init, before
 * every descriptor is necessarily evaluated — building eagerly there would
 * capture a half-built chain. Memoized because the previous implementation was
 * a module-level singleton, and calling the factory per request rebuilt a
 * seven-plugin chain for EVERY details block in the document. A unified
 * processor is safe to reuse once its plugin set is fixed; `processorFactory`
 * caches on exactly that basis.
 *
 * Falls back to the built-in chain when nothing wired one. The fallback is
 * the SAME dialect the table declares — gated — so it is not a silent
 * second-guess, it is the one definition reached by another route.
 */
export function getDetailsBodyParser(): DetailsBodyProcessor {
  memoized ??= (detailsBodyParser ?? buildDefaultBodyProcessor)();
  return memoized;
}
