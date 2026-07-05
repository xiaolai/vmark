/**
 * Code Preview Theme Observer
 *
 * Purpose: Watches documentElement for theme changes — dark-mode class flips
 * AND design-token rewrites (style attribute, written by useTheme on every
 * theme switch) — and propagates them to the Mermaid and Markmap renderers,
 * invalidating and re-rendering cached previews when a theme actually changed.
 *
 * Key decisions:
 *   - Watches `class` + `style` (attributeFilter), because a theme switch
 *     between two light themes (paper -> sepia) never touches the class list;
 *     the token values on the style attribute are the ground truth. Observing
 *     the style attribute also guarantees the invalidation runs AFTER the new
 *     tokens have landed (a settings-store subscription would fire before
 *     useTheme's effect writes them, re-rendering with stale colors).
 *   - Change detection is delegated to each renderer (updateMermaidTheme
 *     compares a token snapshot internally), so mutation storms are cheap
 *     no-ops.
 *   - On change, previews are re-rendered by clearing the preview cache and
 *     dispatching SETTINGS_CHANGED into every active view (same mechanism as
 *     refreshPreviews in tiptap.ts, inlined here to avoid an import cycle).
 *   - Module-level `themeObserverSetup` guard makes setupThemeObserver
 *     idempotent; tiptap.ts calls it once at module load
 *
 * @coordinates-with tiptap.ts — invokes setupThemeObserver() at module load
 * @coordinates-with pluginState.ts — clears previewCache / dispatches on change
 * @coordinates-with shared/diagramThemeTokens.ts — token source for isDark
 * @module plugins/codePreview/themeObserver
 */

import { updateMermaidTheme } from "../mermaid";
import { diagramWarn } from "@/utils/debug";
import { updateMarkmapTheme } from "@/plugins/markmap";
import { errorMessage } from "@/utils/errorMessage";
import { previewCache, activeEditorViews, SETTINGS_CHANGED } from "./pluginState";

let themeObserverSetup = false;

/**
 * Invalidate every cached preview and re-render all active editors.
 * Same mechanics as tiptap.ts's refreshPreviews (inlined: import cycle).
 */
function refreshAllPreviews(): void {
  previewCache.clear();
  for (const view of activeEditorViews) {
    const tr = view.state.tr;
    tr.setMeta(SETTINGS_CHANGED, true);
    view.dispatch(tr);
  }
}

export function setupThemeObserver() {
  /* v8 ignore next -- @preserve module-level themeObserverSetup is set on first call; re-entry and SSR path unreachable in tests */
  if (themeObserverSetup || typeof window === "undefined") return;
  themeObserverSetup = true;

  const observer = new MutationObserver(() => {
    // Any class/style mutation may be a theme change; the renderers compare
    // token snapshots internally and report whether anything changed.
    // Both renderers are evaluated together and the previews refreshed AT
    // MOST ONCE — a dark-mode flip changes both snapshots, and refreshing
    // per-renderer dispatched two invalidation transactions per view.
    const isDark = document.documentElement.classList.contains("dark");
    void Promise.allSettled([updateMermaidTheme(), updateMarkmapTheme(isDark)]).then(
      ([mermaidResult, markmapResult]) => {
        if (mermaidResult.status === "rejected") {
          diagramWarn("Mermaid theme update failed:", errorMessage(mermaidResult.reason));
        }
        if (markmapResult.status === "rejected") {
          diagramWarn("Markmap theme update failed:", errorMessage(markmapResult.reason));
        }
        const themeChanged =
          (mermaidResult.status === "fulfilled" && mermaidResult.value) ||
          (markmapResult.status === "fulfilled" && markmapResult.value);
        if (themeChanged) {
          refreshAllPreviews();
        }
      },
    );
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
}
