/**
 * setupWebglRenderer
 *
 * Purpose: Wires the xterm.js WebGL addon onto a Terminal with robust
 * context-loss recovery and a reset-display escape hatch (#856).
 * Returns the public surface (resetDisplay) and a cleanup hook for dispose.
 *
 * Key decisions:
 *   - The texture atlas is SHARED between terminals. xterm's CharAtlasCache
 *     is a module-global keyed by render config, so every terminal in this
 *     window with the same font/theme/DPR draws from ONE TextureAtlas.
 *     clearTextureAtlas() wipes that shared atlas but clears only the
 *     CALLING renderer's model. A sibling is left holding texture
 *     coordinates into an atlas that has been emptied and repacked with
 *     unrelated glyphs, while its per-cell "nothing changed" check refuses
 *     to repaint those cells — so it renders OTHER characters, permanently,
 *     until something forces a full redraw. Two rules follow:
 *       (a) nothing may clear the atlas unprompted, and
 *       (b) whoever clears it must tell every other live renderer to drop
 *           its model too. See liveRenderers below.
 *     This replaces the page-count bounding added for #856, which violated
 *     (a): it cleared the shared atlas automatically, reentrantly from
 *     inside xterm's per-cell model loop, and never achieved its stated goal
 *     — clearTexture() empties pages but never removes them, so page count
 *     grew anyway. Upstream's own _mergePages already bounds it correctly.
 *   - THE BROADCAST HAS AN EXIT CONDITION, and it is a release, not a date.
 *     xterm.js fixed this upstream in 0b1c0b5c by bumping a
 *     TextureAtlas._pageLayoutVersion on clear, so every owning renderer
 *     rebuilds its model on its next frame — the mechanism page merges and
 *     evictions already had, and strictly better than this per-embedder
 *     registry because it covers a clear from ANY source. That field is
 *     absent from the installed @xterm/addon-webgl 0.19.0.
 *
 *     Do NOT reach for the beta to get it. @xterm/addon-webgl
 *     0.20.0-beta.300 peer-requires @xterm/xterm ^6.1.0-beta.304, so it
 *     moves the terminal CORE off latest too, and the six sibling addons
 *     pinned here declare no peer range — they would silently run against a
 *     core they were not built against. That is seven packages on a master
 *     snapshot (304 beta builds since 2025-12-22, against a 20-month gap
 *     between the last two core stables) to fix one bug that the ~30 lines
 *     below already fix on the released version.
 *
 *     When a STABLE addon release carrying 0b1c0b5c lands, Dependabot's
 *     weekly grouped npm PR will propose it. At that point delete
 *     liveRenderers, the peer object, and the broadcast loop in
 *     resetDisplay, leaving resetDisplay as a plain clear + refresh.
 *     Keeping them after the upgrade is redundant but harmless, so the
 *     upgrade is never blocked on this. The page-count bounding stays
 *     deleted either way: it was VMark's own defect, and the upstream fix
 *     does not address it.
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
 *     atlas, re-paints the viewport, and broadcasts per rule (b). Safe to
 *     call when WebGL is disabled or has already lost context.
 *
 * @coordinates-with createTerminalInstance.ts — sole caller
 * @module components/Terminal/setupWebglRenderer
 */
import { Terminal } from "@xterm/xterm";
import { WebglAddon } from "@xterm/addon-webgl";
import { terminalLog } from "@/utils/debug";

/**
 * Every live renderer in this JS realm that draws from the shared texture
 * atlas. Module-level on purpose: it mirrors the scope of the thing being
 * shared — xterm's CharAtlasCache is a module-global too, so the set of
 * terminals that can poison each other is exactly the set reachable here.
 *
 * Terminals running the DOM renderer (WebGL disabled, or construction
 * failed) never join: they neither read from nor write to the atlas.
 * A terminal that has LOST its context stays registered — its sync degrades
 * to a harmless viewport refresh, and staying registered keeps the
 * bookkeeping symmetric with cleanup().
 */
const liveRenderers = new Set<{ syncAfterAtlasClear: () => void }>();

/** Public surface returned by setupWebglRenderer to the factory. */
export interface WebglRendererHandle {
  /**
   * Manually clears the WebGL texture atlas (if active), re-paints the
   * viewport, and tells every other live WebGL terminal to drop its model
   * so it re-resolves its glyphs against the repacked atlas. Safe to call
   * when WebGL is disabled or already disposed.
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
 * Attach the WebGL addon (when enabled) plus context-loss recovery and a
 * canvas-replacement observer. Returns a handle exposing resetDisplay() and
 * a cleanup hook.
 */
export function setupWebglRenderer({ term, container, enabled }: SetupOptions): WebglRendererHandle {
  let webglAddon: WebglAddon | null = null;
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

  /**
   * Drop this terminal's atlas-derived state and re-paint it. Does NOT
   * broadcast — the caller decides.
   *
   * On the terminal that initiates a reset this wipes the shared atlas AND
   * clears this renderer's model. On a terminal reached by the broadcast the
   * atlas has just been emptied, so xterm's clearTexture() early-returns and
   * this performs only the local model clear — which is exactly the step
   * that terminal was missing.
   */
  const clearOwnAtlasAndRepaint = () => {
    if (webglAddon) {
      try {
        webglAddon.clearTextureAtlas();
      } catch {
        // Addon may have been disposed between calls — safe to ignore.
      }
    }
    refreshViewport();
  };

  const peer = { syncAfterAtlasClear: clearOwnAtlasAndRepaint };

  const handleContextLoss = () => {
    if (!webglAddon) return;
    try {
      webglAddon.dispose();
    } catch {
      // Already disposing or never fully initialized — safe to ignore.
    }
    webglAddon = null;
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

      term.loadAddon(addon);

      // Only terminals that actually draw from the shared atlas take part in
      // the clear broadcast (rule (b) in the module header).
      liveRenderers.add(peer);

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
    // Whether we are about to disturb the SHARED atlas, decided before the
    // clear: a DOM-renderer terminal (disabled, construction failed, or
    // context lost) touches no atlas, so it has nobody to warn.
    const willClearSharedAtlas = webglAddon !== null;

    clearOwnAtlasAndRepaint();
    if (!willClearSharedAtlas) return;

    for (const other of liveRenderers) {
      if (other === peer) continue;
      try {
        other.syncAfterAtlasClear();
      } catch {
        // A sibling caught mid-dispose must not abort the rest of the
        // broadcast — every remaining terminal still needs its model dropped.
      }
    }
  };

  const cleanup = () => {
    liveRenderers.delete(peer);
    drainDomCleanups();
    // The addon itself is disposed by term.dispose() via the registered addon.
  };

  return { resetDisplay, cleanup };
}
