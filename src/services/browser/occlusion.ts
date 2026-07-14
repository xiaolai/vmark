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
 * Correctness (R2): freeze/thaw are async and may fail, and they act on a NATIVE
 * view — what matters is the state the driver actually applied, not the state we
 * hoped for. So the controller keeps two facts per tab: the *desired* state (from
 * the occluder set, reported immediately by `isFrozen`) and the *confirmed* state
 * (what the driver acknowledged). A single serialized loop per tab reconciles one
 * toward the other: never two native ops in flight for one tab, so the driver's
 * call order IS the intent order and a slow freeze can never land after the thaw
 * that superseded it. Intent churn while an op runs is coalesced — only the
 * newest intent is applied once the in-flight op completes.
 *
 * A driver failure leaves the confirmed state untouched (an unconfirmed freeze is
 * NOT recorded as hidden), so the next reconcile retries it, and a thaw is never
 * sent for a view the driver never froze. The desired state never flips on
 * failure: a failed snapshot keeps the intent "hidden" — never show a stale live
 * frame under an overlay.
 *
 * "The next reconcile" only arrives when an occluder is added or removed, which is not
 * enough on its own: a freeze can fail because the tab's native view does not exist YET
 * (the surface seeds its store entry before `browser_create` resolves, and the command
 * palette — an occluder — is how you open a browser tab). No occluder changes while that
 * create is in flight, so nothing retried and the view came up live over the overlay.
 * `resync` is the missing trigger: call it when a tab's view becomes available.
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
  /** Intent: should the tab's native view be hidden right now? */
  private readonly desired = new Map<string, boolean>();
  /** Reality: the last state the driver acknowledged applying. */
  private readonly confirmed = new Map<string, boolean>();
  /** Tabs whose serialized op loop is currently running. */
  private readonly pumping = new Set<string>();
  /** Tabs whose native view changed under an in-flight op — see `pump`. */
  private readonly stale = new Set<string>();

  constructor(private readonly driver: OcclusionDriver) {}

  /** An overlay/drag now covers the browser tab. */
  addOccluder(tabId: string, occluderId: string): void {
    const set = this.setFor(tabId);
    if (set.has(occluderId)) return;
    set.add(occluderId);
    this.reconcile(tabId);
  }

  /** An overlay/drag stopped covering the browser tab. */
  removeOccluder(tabId: string, occluderId: string): void {
    // `delete` is false when the occluder was never tracked → nothing changed.
    if (!this.occluders.get(tabId)?.delete(occluderId)) return;
    this.reconcile(tabId);
  }

  /** Whether the tab's native view should currently be frozen (the intent, which
   *  a failed driver op never flips — see R2 in the module docs). */
  isFrozen(tabId: string): boolean {
    return this.desired.get(tabId) ?? false;
  }

  /**
   * Re-drive the tab toward its desired state.
   *
   * A driver failure deliberately leaves `confirmed` untouched so the next reconcile
   * retries it — but a reconcile only happens when an occluder is added or removed, and
   * the case that matters has neither. `BrowserSurface` seeds its store entry *before*
   * invoking `browser_create`, so an overlay that is already up (the command palette is
   * how you open a browser tab) freezes a tab whose native view does not exist yet. Rust
   * rejects it, correctly; nothing then retried, and the view finished creating and came
   * up LIVE on top of the overlay. Call this when a tab's native view becomes available:
   * it makes the "next reconcile" actually arrive. (Audit verification, #4.)
   *
   * Idempotent — a no-op when reality already matches intent.
   */
  resync(tabId: string): void {
    // Marked BEFORE pumping: if an op is already in flight against the world as it was, the
    // early return in `pump` would otherwise drop this on the floor.
    this.stale.add(tabId);
    void this.pump(tabId);
  }

  /** Drop all occlusion state for a closed tab (no thaw — the view is gone).
   *  A running op loop observes this and stops before touching the driver again. */
  removeTab(tabId: string): void {
    this.occluders.delete(tabId);
    this.desired.delete(tabId);
    this.confirmed.delete(tabId);
    this.stale.delete(tabId);
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
    this.desired.set(tabId, (this.occluders.get(tabId)?.size ?? 0) > 0);
    void this.pump(tabId);
  }

  /**
   * Drive the tab's confirmed state toward its desired state, one native op at a
   * time. At most one loop runs per tab, and it re-reads `desired` after every
   * completion — so intent that changed mid-op is picked up, and superseded
   * intent is simply never sent.
   *
   * `stale` is why a failed op is not simply abandoned. A driver failure normally means
   * "this cannot work right now", and retrying it on the spot would spin. But a resync says
   * something else — *the world changed, the view exists now* — and it can arrive while the
   * doomed op is still in flight, where the early return below would swallow it. So a
   * resync marks the tab stale, and a failure is retried exactly when the attempt it failed
   * on was made against a world that has since changed. One retry per resync: no spin.
   */
  private async pump(tabId: string): Promise<void> {
    if (this.pumping.has(tabId)) return; // the running loop will observe `stale`
    this.pumping.add(tabId);
    try {
      for (;;) {
        if (!this.occluders.has(tabId)) return; // tab closed — its view is gone
        const want = this.desired.get(tabId) ?? false;
        if (want === (this.confirmed.get(tabId) ?? false)) return; // reality matches intent
        // We are about to act on the world as it stands. Anything that changes it from here
        // on re-marks the tab, and the catch below will see that and try again.
        this.stale.delete(tabId);
        try {
          await (want ? this.driver.freeze(tabId) : this.driver.thaw(tabId));
        } catch {
          // Unconfirmed: leave `confirmed` as-is so no thaw is ever sent for a view the
          // driver never actually froze. The intent stands — a failed freeze must not
          // reveal a live frame.
          if (this.stale.has(tabId)) continue; // the view arrived mid-flight: try again
          return;
        }
        if (!this.occluders.has(tabId)) return; // closed while the op was in flight
        this.confirmed.set(tabId, want);
      }
    } finally {
      this.pumping.delete(tabId);
    }
  }
}
