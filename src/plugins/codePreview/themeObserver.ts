/**
 * Code Preview Theme Observer
 *
 * Purpose: Watches the documentElement class attribute for dark-mode flips and
 * propagates the theme to the Mermaid and Markmap renderers, clearing the preview
 * cache when a theme actually changed. Split from tiptap.ts for size.
 *
 * Key decisions:
 *   - Module-level `themeObserverSetup` guard makes setupThemeObserver idempotent;
 *     tiptap.ts calls it once at module load
 *
 * @coordinates-with tiptap.ts — invokes setupThemeObserver() at module load
 * @coordinates-with pluginState.ts — clears previewCache on theme change
 * @module plugins/codePreview/themeObserver
 */

import { updateMermaidTheme } from "../mermaid";
import { diagramWarn } from "@/utils/debug";
import { updateMarkmapTheme } from "@/plugins/markmap";
import { errorMessage } from "@/utils/errorMessage";
import { previewCache } from "./pluginState";

let themeObserverSetup = false;

export function setupThemeObserver() {
  /* v8 ignore next -- @preserve module-level themeObserverSetup is set on first call; re-entry and SSR path unreachable in tests */
  if (themeObserverSetup || typeof window === "undefined") return;
  themeObserverSetup = true;

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.attributeName === "class") {
        const isDark = document.documentElement.classList.contains("dark");
        updateMermaidTheme(isDark).then((themeChanged) => {
          if (themeChanged) {
            previewCache.clear();
          }
        }).catch((error: unknown) => {
          /* v8 ignore next -- @preserve non-Error rejections from updateMermaidTheme are theoretically possible but untestable without mocking the MutationObserver callback chain */
          diagramWarn("Mermaid theme update failed:", errorMessage(error));
        });
        /* v8 ignore start -- @preserve Symmetric with updateMermaidTheme above. Branch coverage is exercised by the markmap module's own tests; the MutationObserver-driven test in tiptap.test.ts can only hit the resolved path, leaving the no-op branch (themeChanged=false) and the .catch path uncoverable from this layer. */
        updateMarkmapTheme(isDark).then((themeChanged) => {
          if (themeChanged) {
            previewCache.clear();
          }
        }).catch((error: unknown) => {
          diagramWarn("Markmap theme update failed:", errorMessage(error));
        });
        /* v8 ignore stop */
      }
    }
  });

  observer.observe(document.documentElement, { attributes: true });
}
