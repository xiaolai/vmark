/**
 * Per-tab ledger of COMMITTED navigation ids (audit round 3, #87).
 *
 * Purpose: decide, from what this window has itself observed, whether a
 * `browser://load-failed` names a navigation the tab has already moved past.
 * `browserTabEvents` used to ask the broker for `latestNavigationId`, but the broker
 * listens to the same failure event and adopts the failing id as "latest" — so
 * whether a superseded failure was recognised depended on which listener the
 * runtime happened to call first. This ledger is fed only by commits, which the
 * failure event can never write, so the answer is the same in either order.
 *
 * What "superseded" means here: the id COMMITTED (a `browser://navigated` carried
 * it) and a later commit under a different id replaced it. An id the ledger has
 * never seen is NOT superseded — a provisional load that never commits (DNS, TLS, a
 * refused connection) fails under an id no commit ever carried, and that is the
 * common, current, real failure the overlay exists for. Filtering a stale
 * provisional failure is the driver's job (`is_current_navigation` in
 * `nav_failure_macos.rs`); this is the frontend's defence for the post-commit case.
 *
 * Memory is bounded like the driver's ring: at most `maxSuperseded` replaced ids
 * per tab, oldest evicted first, and `forget(tabId)` drops a closed tab.
 *
 * @coordinates-with services/browser/browserTabEvents — feeds commits, consults on failure
 * @coordinates-with src-tauri browser/nav_failure_macos.rs — filters non-current failures at source
 * @module services/browser/committedNavigations
 */

interface TabCommits {
  /** The id of the most recent commit. */
  current: string;
  /** Ids this tab committed and then replaced, oldest first. */
  superseded: string[];
}

export class CommittedNavigations {
  private readonly byTab = new Map<string, TabCommits>();

  constructor(private readonly maxSuperseded = 8) {}

  /** A `browser://navigated` for `tabId` carried `navigationId`. Re-committing the
   *  current id (a redirect hop, a reload) changes nothing. */
  commit(tabId: string, navigationId: string): void {
    const commits = this.byTab.get(tabId);
    if (!commits) {
      this.byTab.set(tabId, { current: navigationId, superseded: [] });
      return;
    }
    if (commits.current === navigationId) return;
    const superseded = [...commits.superseded.filter((id) => id !== navigationId), commits.current];
    while (superseded.length > this.maxSuperseded) superseded.shift();
    this.byTab.set(tabId, { current: navigationId, superseded });
  }

  /** Did `navigationId` commit on this tab and get replaced by a later commit? */
  isSuperseded(tabId: string, navigationId: string): boolean {
    return this.byTab.get(tabId)?.superseded.includes(navigationId) ?? false;
  }

  /** The tab is gone: drop its record. */
  forget(tabId: string): void {
    this.byTab.delete(tabId);
  }
}
