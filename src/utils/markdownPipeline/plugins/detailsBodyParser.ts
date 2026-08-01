/**
 * Purpose: the injection seam for the `<details>` body parser.
 *
 * `remarkDetailsBlock` is registered BY the document chain, so importing that
 * chain's builder from the plugin would close a cycle. `dialect.ts` — the
 * module that owns the plugin lists — wires the factory here instead, and the
 * plugin only ever asks for it.
 *
 * The body dialect deliberately EXCLUDES `remarkDetailsBlock`: that is what
 * stops a body parser needing a body parser. Nested `<details>` are handled by
 * the outer pass's depth tracking (WI-3.1).
 *
 * @coordinates-with dialect.ts — calls setDetailsBodyParser at module init
 * @coordinates-with detailsBlock.ts — the only consumer
 * @module utils/markdownPipeline/plugins/detailsBodyParser
 */

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
 * Throws by NAME when unwired rather than falling back to a default dialect:
 * a body silently parsed with the wrong plugin set is a correctness bug that
 * looks like working software.
 */
export function getDetailsBodyParser(): DetailsBodyProcessor {
  if (!detailsBodyParser) {
    throw new Error(
      "details body parser not wired — import `utils/markdownPipeline/dialect` " +
        "before parsing, so `setDetailsBodyParser` has run.",
    );
  }
  memoized ??= detailsBodyParser();
  return memoized;
}
