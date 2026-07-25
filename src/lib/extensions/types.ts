/**
 * Extension descriptor contract — ADR-015 D1, WI-1.1.
 *
 * Purpose: the single shape every VMark feature declares itself as, so that the
 * registry IS the composition rather than metadata describing it.
 *
 * Why a descriptor with a stable `id` and not CodeMirror-style value identity:
 * CodeMirror can dedup on object identity because its extensions are
 * module-level singletons. VMark's are not — `tiptapExtensions.ts` builds values
 * inline via `StarterKit.configure(...)` and `Link.extend(...).configure(...)`,
 * so every factory call yields a fresh object. Ordering by named peer, duplicate
 * detection, lifecycle teardown, third-party namespace ownership, the
 * registry↔composition contract test, and diagnostics naming a winning converter
 * all need a stable name. Tiptap itself resolves conflicts by extension name.
 *
 * What is deliberately NOT contributable yet:
 *   - commands — `src/services/commands/` (49 `registerCommand` sites) and
 *     `src/plugins/actions/types.ts` (83 `ActionId`s) are disjoint registries
 *     with no bridge, and the editing surface lives in the second. Picking
 *     either forfeits the other. Resolving that fork is a prerequisite.
 *   - panels/overlays — ADR-007's slot seam exists on neither side:
 *     `SlotDescriptor` is declared but `AppShell` has no registration API and
 *     `App.tsx` hardcodes 15 overlays.
 * Adding a `kind` for either before its seam exists would recreate the
 * foundation-shaped dead code this ADR is a reaction to.
 *
 * @module lib/extensions/types
 */

/** Stable, globally unique extension name, e.g. `vmark.markdown`. */
export type ExtensionId = string;

/**
 * Coarse ordering bucket. Five named buckets, not an integer scale — integers
 * are unbounded, unauditable, and invite `priority: 1001` escalation.
 */
export type Prec = "highest" | "high" | "default" | "low" | "lowest";

/** Bucket ordering, highest first. */
export const PREC_ORDER: readonly Prec[] = [
  "highest",
  "high",
  "default",
  "low",
  "lowest",
];

/**
 * Ordering constraints.
 *
 * `bucket` is the coarse layer; `before`/`after` express genuinely pairwise
 * constraints against a NAMED peer, the way `@lezer/markdown`'s BlockParser
 * does. Referencing an id that was never registered is an error, not a silent
 * no-op — a typo'd constraint that quietly does nothing is how ordering bugs
 * survive.
 */
export interface ExtensionOrdering {
  bucket?: Prec;
  before?: readonly ExtensionId[];
  after?: readonly ExtensionId[];
}

/**
 * What an extension contributes. Each kind is a separate registry; an extension
 * may contribute to several.
 *
 * `markdown` and `pmAdapter` are the two halves of ADR-015 D2. They are distinct
 * kinds precisely so the markdown half stays engine-independent and Node-safe:
 * collapsing them would re-couple markdown to the editor and break the
 * `nodeSafe.ts` boundary `vmark-content-server` depends on.
 */
export type Contribution =
  | { kind: "tiptap"; factory: () => unknown }
  | { kind: "codemirror"; factory: () => unknown }
  /** Registry 1 — markdown ↔ mdast. Must not reference ProseMirror. */
  | { kind: "markdown"; factory: () => unknown }
  /** Registry 2 — mdast ↔ ProseMirror. Engine-coupled by nature. */
  | { kind: "pmAdapter"; factory: () => unknown };

/** The unit of composition. */
export interface VMarkExtension {
  id: ExtensionId;
  version?: string;
  /** Ids that must also be present. Missing dependencies are an error. */
  requires?: readonly ExtensionId[];
  ordering?: ExtensionOrdering;
  contributions: readonly Contribution[];
}

/**
 * Grouping for authoring and distribution.
 *
 * Nesting exists only at authoring time and is flattened at resolve time — the
 * shape every prior-art system converges on (Tiptap `flat(10)`,
 * `MarkdownExtension = Config | readonly Config[]`, `gfmFromMarkdown()`).
 * There is no runtime hierarchy and no nested namespace.
 */
export type ExtensionGroup = VMarkExtension | readonly ExtensionGroup[];

/** A problem found during resolution. */
export interface ResolutionError {
  code:
    | "duplicate-id"
    | "missing-requirement"
    | "unknown-ordering-ref"
    | "ordering-cycle"
    | "empty-id"
    | "invalid-descriptor"
    | "self-reference";
  message: string;
  /** Extensions involved; for `ordering-cycle` this is the full cycle path. */
  ids: readonly ExtensionId[];
}

/** Successful resolution: extensions in composition order. */
export interface Resolution {
  ordered: readonly VMarkExtension[];
  errors: readonly ResolutionError[];
}
