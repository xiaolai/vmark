/**
 * Fence-language extension point — ADR-015 D3, Phase 5 WI-5.1.
 *
 * Purpose: let markdown OWN a keyed registry of fenced-code renderers, so
 * mermaid, graphviz, markmap, svg and the workflow preview stop being an
 * `if (language === "…")` chain inside the markdown plugin.
 *
 * This is the shape the maintainer originally described as "mermaid is a
 * sub-extension of markdown". Prior art says hierarchy is the wrong model —
 * every system examined flattens — and that markdown-hosts-foreign-content is
 * universally a **host-owned keyed registry contributed to by peers**:
 * `@codemirror/lang-markdown`'s `codeLanguages`, Obsidian's
 * `registerMarkdownCodeBlockProcessor(language, …)`, VSCode's `injectTo`. In all
 * three the contributor is a top-level extension, never a child.
 *
 * So: markdown declares this point; a diagram renderer registers into it as a
 * peer. A renderer can therefore also serve other hosts later (table cells, the
 * source pane) without being trapped under markdown — which is precisely what a
 * parent/child relationship would prevent.
 *
 * Claiming rules match the rest of ADR-015: exactly one renderer may claim a
 * language, and two claiming the same one is an error rather than a
 * first-registered race.
 *
 * @coordinates-with lib/extensions/claim.ts — same conflict philosophy
 * @coordinates-with previewDecorations.ts — the sole consumer
 * @module plugins/codePreview/fenceRegistry
 */
import type { Decoration, EditorView } from "@tiptap/pm/view";
import type { PreviewCache } from "./previewHelpers";

/** Everything a fence renderer needs to build its decoration. */
interface FenceRenderContext {
  nodeEnd: number;
  content: string;
  cacheKey: string;
  previewCache: PreviewCache;
  onEnterEdit: (view: EditorView | null | undefined) => void;
}

/** A contributed renderer for one or more fence languages. */
export interface FenceRenderer {
  /** Stable id of the contributing extension, e.g. `vmark.mermaid`. */
  extensionId: string;
  /**
   * Languages claimed exactly. Use `matches` instead when a family has aliases
   * (graphviz accepts `dot`, `graphviz`, …).
   */
  languages?: readonly string[];
  /** Predicate for language families. Checked when `languages` does not match. */
  matches?: (language: string) => boolean;
  /** i18n key for the label shown when the fence is empty. */
  emptyLabelKey?: string;
  /**
   * Whether the header offers "copy source". Diagram renderers do; math does
   * not, because its source is already visible in the fence.
   */
  copyable?: boolean;
  create: (context: FenceRenderContext) => Decoration;
}

export class FenceRegistrationError extends Error {}

const renderers: FenceRenderer[] = [];

/** Undo a registration. Idempotent. */
export type Unregister = () => void;

/**
 * Register a fence renderer. Throws if it collides with an existing claim.
 *
 * Returns an unregister function (WI-5.6). Obsidian's `Component` ties every
 * `register*` call to plugin unload, and the lesson from that API is that
 * teardown has to exist BEFORE third parties arrive — retrofitting it means
 * every existing extension leaks. A first-party renderer never unregisters
 * today, but the contract is the same one a plugin will use.
 */
export function registerFenceRenderer(renderer: FenceRenderer): Unregister {
  // A renderer with no claim at all can never be resolved — a silent dead
  // registration. Reject it at the boundary rather than let it accumulate.
  if (!renderer.languages?.length && renderer.matches === undefined) {
    throw new FenceRegistrationError(
      `\`${renderer.extensionId}\` declares neither \`languages\` nor \`matches\`, ` +
        "so it can never claim a fence language.",
    );
  }
  for (const language of renderer.languages ?? []) {
    const existing = renderers.find((r) => r.languages?.includes(language));
    if (existing !== undefined) {
      throw new FenceRegistrationError(
        `Both \`${existing.extensionId}\` and \`${renderer.extensionId}\` claim the ` +
          `fence language \`${language}\`. Exactly one renderer may own a language.`,
      );
    }
  }
  renderers.push(renderer);

  let done = false;
  return () => {
    if (done) return;
    done = true;
    const at = renderers.indexOf(renderer);
    if (at !== -1) renderers.splice(at, 1);
  };
}

/**
 * The renderer owning `language`, or null.
 *
 * Exact language claims are checked before predicate families, so a specific
 * claim always beats a broad one and registration order never decides ownership.
 */
export function resolveFenceRenderer(language: string): FenceRenderer | null {
  const exact = renderers.find((r) => r.languages?.includes(language));
  if (exact !== undefined) return exact;

  const byPredicate = renderers.filter((r) => {
    try {
      return r.matches?.(language) ?? false;
    } catch {
      // A broken predicate declines rather than breaking the document.
      return false;
    }
  });

  if (byPredicate.length > 1) {
    throw new FenceRegistrationError(
      `${byPredicate.length} renderers match fence language \`${language}\`: ` +
        `${byPredicate.map((r) => r.extensionId).join(", ")}. Ownership is ambiguous.`,
    );
  }
  return byPredicate[0] ?? null;
}

/** True when any renderer claims `language`. */
export function hasFenceRenderer(language: string): boolean {
  return resolveFenceRenderer(language) !== null;
}

/** Languages with an exact claim, for diagnostics and tests. */
export function registeredFenceLanguages(): readonly string[] {
  return renderers.flatMap((r) => [...(r.languages ?? [])]).sort();
}

/** Test-only reset. */
export function _resetFenceRenderers(): void {
  renderers.length = 0;
}
