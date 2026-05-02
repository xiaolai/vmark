/**
 * setupWebglRenderer
 *
 * Purpose: Wires the xterm.js WebGL addon onto a Terminal with the bounded-
 * atlas, robust-context-loss, and reset-display behavior introduced for #856.
 * Returns the public surface (resetDisplay) and a cleanup hook for dispose.
 *
 * Key decisions:
 *   - Atlas page count is bounded via onAddTextureAtlasCanvas /
 *     onRemoveTextureAtlasCanvas (#856). Once the count crosses
 *     ATLAS_PAGE_LIMIT the atlas is cleared and the count resets, so
 *     long sessions with heavily styled output (chalk-painted CLIs +
 *     minimumContrastRatio) cannot grow GPU memory unboundedly and
 *     produce glyph corruption.
 *   - Context loss is detected at TWO layers: the addon's onContextLoss
 *     callback and a DOM-level webglcontextlost listener on each render
 *     canvas. VS Code's microsoft/vscode#120393 documents that the addon
 *     callback can fail to fire after silent context loss (sleep/wake);
 *     the DOM listener catches that.
 *   - A MutationObserver watches for canvases added to or removed from
 *     the container after the initial loadAddon, so DOM listeners stay
 *     attached to whichever canvases the renderer paints into.
 *   - On context loss, the addon is disposed and xterm 6.0's built-in
 *     DOM renderer takes over automatically (the canvas addon was
 *     removed in 6.0, so DOM is the only fallback).
 *   - resetDisplay() is the user-facing escape hatch: it clears the
 *     atlas and refreshes the viewport. Safe to call when WebGL is
 *     disabled or has already lost context.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupWebglRenderer
 */
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { terminalLog } from "@/utils/debug";

/**
 * Maximum WebGL texture-atlas pages permitted before forcing a clear (#856).
 * xterm allocates a new 512×512 page each time the current pages can't fit
 * a new (glyph + style + fg + bg) combination. With minimumContrastRatio's
 * per-cell foreground lift active, heavily styled output multiplies unique
 * combinations and can grow the atlas indefinitely, producing glyph
 * corruption. 4 pages is xterm.js' own merging trigger heuristic.
 */
export const ATLAS_PAGE_LIMIT = 4;

/** Public surface returned by setupWebglRenderer to the factory. */
export interface WebglRendererHandle {
  /**
   * Manually clears the WebGL texture atlas (if active) and re-paints the
   * viewport. Safe to call when WebGL is disabled or already disposed.
   */
  resetDisplay: () => void;
  /** Tear down all listeners. Idempotent. */
  cleanup: () => void;
}

interface SetupOptions {
  term: Terminal;
  container: HTMLElement;
  /** When false, this is a no-op renderer handle that only refreshes on resetDisplay. */
  enabled: boolean;
}

/**
 * Attach the WebGL addon (when enabled) plus atlas bounding, context-loss
 * recovery, and a canvas-replacement observer. Returns a handle exposing
 * resetDisplay() and a cleanup hook.
 */
export function setupWebglRenderer({ term, container, enabled }: SetupOptions): WebglRendererHandle {
  let webglAddon: WebglAddon | null = null;
  let atlasPageCount = 0;
  const domCleanups: Array<() => void> = [];

  const drainDomCleanups = () => {
    while (domCleanups.length > 0) {
      const fn = domCleanups.pop();
      if (fn) fn();
    }
  };

  const refreshViewport = () => {
    try {
      const lastRow = Math.max(0, term.rows - 1);
      term.refresh(0, lastRow);
    } catch {
      // term may already be disposed — safe to ignore.
    }
  };

  const handleContextLoss = () => {
    if (!webglAddon) return;
    try {
      webglAddon.dispose();
    } catch {
      // Already disposing or never fully initialized — safe to ignore.
    }
    webglAddon = null;
    atlasPageCount = 0;
    drainDomCleanups();
    terminalLog("WebGL context lost — terminal falling back to DOM renderer");
  };

  /** Attach a webglcontextlost listener; remember how to remove it on cleanup. */
  const bindCanvas = (canvas: HTMLCanvasElement) => {
    const listener = () => handleContextLoss();
    canvas.addEventListener("webglcontextlost", listener);
    domCleanups.push(() => {
      canvas.removeEventListener("webglcontextlost", listener);
    });
  };

  if (enabled) {
    try {
      const addon = new WebglAddon();
      webglAddon = addon;

      addon.onContextLoss(handleContextLoss);

      // Bound atlas growth (#856): clear when too many pages accumulate.
      addon.onAddTextureAtlasCanvas(() => {
        atlasPageCount += 1;
        if (atlasPageCount >= ATLAS_PAGE_LIMIT) {
          try {
            addon.clearTextureAtlas();
          } catch {
            // Renderer may already be disposed — safe to ignore.
          }
          atlasPageCount = 0;
        }
      });

      addon.onRemoveTextureAtlasCanvas(() => {
        atlasPageCount = Math.max(0, atlasPageCount - 1);
      });

      term.loadAddon(addon);

      // Bind every canvas currently inside the container (defense-in-depth
      // against silent context loss; see module header).
      const canvases = container.querySelectorAll<HTMLCanvasElement>("canvas");
      canvases.forEach(bindCanvas);

      // Canvas elements may be replaced if xterm rebuilds its renderer (e.g.
      // size changes that recreate the canvas). Watch for additions and
      // removals so DOM listeners follow the live canvases.
      if (typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            m.addedNodes.forEach((node) => {
              if (node instanceof HTMLCanvasElement) bindCanvas(node);
              else if (node instanceof Element) {
                node.querySelectorAll<HTMLCanvasElement>("canvas").forEach(bindCanvas);
              }
            });
          }
        });
        observer.observe(container, { childList: true, subtree: true });
        domCleanups.push(() => observer.disconnect());
      }
    } catch {
      /* v8 ignore start -- @preserve reason: WebGL constructor failure only fires on GPU init failure; not reproducible in jsdom */
      webglAddon = null;
      /* v8 ignore stop */
    }
  }

  const resetDisplay = () => {
    if (webglAddon) {
      try {
        webglAddon.clearTextureAtlas();
      } catch {
        // Addon may have been disposed between calls — safe to ignore.
      }
      atlasPageCount = 0;
    }
    refreshViewport();
  };

  const cleanup = () => {
    drainDomCleanups();
    // The addon itself is disposed by term.dispose() via the registered addon.
  };

  return { resetDisplay, cleanup };
}
