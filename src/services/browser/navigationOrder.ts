/**
 * Per-tab ORDER of navigation ids (audit 2026-09-03 round 4, #87).
 *
 * Purpose: decide whether a `browser://load-failed` names a navigation this tab has
 * already moved past, from the ids alone. The driver mints every id as
 * `nav-<tabId>-<sequence>` from ONE monotonic per-tab counter
 * (`registry_navigation.rs::begin_navigation`), so two ids of the same tab are
 * ordered by their sequence — no lookup is needed, only a comparison.
 *
 * Why order, not a ledger. Round 3 kept a ring of COMMITTED ids and called a failure
 * superseded when its id was in the ring. Two classes escaped it: a provisional
 * navigation (DNS, TLS, a refused connection) never commits, so its id was never in
 * the ring and a late report of its failure could paint over the page that loaded
 * fine after it; and the ring was eight deep, so the ninth navigation evicted an id
 * whose late failure then looked "unknown" — and showed. Under order both are one
 * rule: a failure whose sequence is BELOW the highest this tab has shown — from any
 * event, committed or not — is about a page nobody is looking at. A provisional
 * failure is the highest when it arrives, so it shows; a later report about it is
 * below whatever came next, so it does not.
 *
 * An id that carries no order for this tab (`legacy-<tabId>` from an older driver, a
 * malformed payload, a ticket minted for another tab) is neither recorded nor
 * superseded — the pre-order rule: show it.
 *
 * Fed only by NATIVE events, never by an MCP argument: a client-supplied sequence
 * could otherwise suppress a real failure's overlay by claiming a higher one.
 *
 * @coordinates-with services/browser/browserTabEvents — observes every native navigation event, consults on failure
 * @coordinates-with src-tauri browser/registry_navigation.rs — mints `nav-<tabId>-<sequence>`
 * @module services/browser/navigationOrder
 */

/** A canonical non-negative integer: no sign, no leading zero, no fraction. */
const SEQUENCE = /^(0|[1-9]\d*)$/;

/** The sequence `navigationId` carries for `tabId`, or undefined when it carries none. */
export function navigationSequence(tabId: string, navigationId: string): number | undefined {
  const prefix = `nav-${tabId}-`;
  if (!navigationId.startsWith(prefix)) return undefined;
  const digits = navigationId.slice(prefix.length);
  if (!SEQUENCE.test(digits)) return undefined;
  const sequence = Number(digits);
  return Number.isSafeInteger(sequence) ? sequence : undefined;
}

export class NavigationOrder {
  /** The highest sequence each tab has shown, from any event. */
  private readonly highest = new Map<string, number>();

  /** A native event for `tabId` carried `navigationId`: the tab is at least this far along. */
  observe(tabId: string, navigationId: string): void {
    const sequence = navigationSequence(tabId, navigationId);
    if (sequence === undefined) return;
    const known = this.highest.get(tabId);
    if (known === undefined || sequence > known) this.highest.set(tabId, sequence);
  }

  /** Is `navigationId` older than a navigation this tab has already shown? */
  isSuperseded(tabId: string, navigationId: string): boolean {
    const sequence = navigationSequence(tabId, navigationId);
    if (sequence === undefined) return false;
    const known = this.highest.get(tabId);
    return known !== undefined && sequence < known;
  }

  /** The tab is gone: drop its record. */
  forget(tabId: string): void {
    this.highest.delete(tabId);
  }
}
