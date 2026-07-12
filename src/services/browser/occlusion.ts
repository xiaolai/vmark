/**
 * Browser occlusion controller (WI-1.4 / R2).
 *
 * Purpose: the native webview is a sibling native view that paints ABOVE all DOM
 * regardless of z-index, so any overlay (command palette, dialog, context menu,
 * a split-drag preview) that covers the browser rect would otherwise be hidden
 * behind a live page. This controller tracks which occluders currently cover a
 * browser tab and drives the native side to **freeze** (snapshot + hide the
 * native view) while any occluder is present, and **thaw** (show it) once the
 * last one goes away.
 *
 * Correctness (R2): freeze/thaw are async and may fail. State is applied
 * optimistically and guarded by a per-tab generation counter so that, under
 * rapid open/close, only the latest intent wins and a stale async completion
 * never overrides it. A failed freeze (snapshot) falls back to keeping the view
 * hidden — never show a stale live frame under an overlay.
 *
 * Pure orchestration: the actual snapshot/hide/show is the injected
 * `OcclusionDriver` (the Rust `browser_freeze`/`browser_thaw` commands in
 * production, a mock in tests). The overlay/drag event wiring is a thin adapter
 * layered on top.
 *
 * @coordinates-with (future) src-tauri browser_freeze/browser_thaw commands
 * @coordinates-with AppShell overlays + paneStore drag state — occluder sources
 * @module services/browser/occlusion
 */

/** The native side of freeze/thaw (snapshot+hide / show). */
export interface OcclusionDriver {
  freeze(tabId: string): Promise<void>;
  thaw(tabId: string): Promise<void>;
}

export class OcclusionController {
  private readonly occluders = new Map<string, Set<string>>();
  private readonly frozen = new Map<string, boolean>();
  private readonly gen = new Map<string, number>();

  constructor(private readonly driver: OcclusionDriver) {}

  /** An overlay/drag now covers the browser tab. */
  addOccluder(tabId: string, occluderId: string): void {
    this.setFor(tabId).add(occluderId);
    this.reconcile(tabId);
  }

  /** An overlay/drag stopped covering the browser tab. */
  removeOccluder(tabId: string, occluderId: string): void {
    this.occluders.get(tabId)?.delete(occluderId);
    this.reconcile(tabId);
  }

  /** Whether the tab's native view is currently frozen (intended state). */
  isFrozen(tabId: string): boolean {
    return this.frozen.get(tabId) ?? false;
  }

  /** Drop all occlusion state for a closed tab (no thaw — the view is gone). */
  removeTab(tabId: string): void {
    this.occluders.delete(tabId);
    this.frozen.delete(tabId);
    this.gen.delete(tabId);
  }

  private setFor(tabId: string): Set<string> {
    let set = this.occluders.get(tabId);
    if (!set) {
      set = new Set();
      this.occluders.set(tabId, set);
    }
    return set;
  }

  private reconcile(tabId: string): void {
    const shouldFreeze = (this.occluders.get(tabId)?.size ?? 0) > 0;
    if (shouldFreeze === this.isFrozen(tabId)) return; // already in the desired state

    const generation = (this.gen.get(tabId) ?? 0) + 1;
    this.gen.set(tabId, generation);
    this.frozen.set(tabId, shouldFreeze); // optimistic — reflected immediately

    const op = shouldFreeze ? this.driver.freeze(tabId) : this.driver.thaw(tabId);
    op.catch(() => {
      // A newer intent superseded this op — ignore its (stale) failure.
      if (this.gen.get(tabId) !== generation) return;
      // Freeze snapshot failed → keep the view hidden (frozen stays true, the
      // safe fallback). Thaw failure leaves the thawed intent for a later retry.
      // Either way, never flip to showing a stale live frame under an overlay.
    });
  }
}
