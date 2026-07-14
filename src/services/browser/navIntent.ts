/**
 * navIntent — how the user set off (WI-S2.2).
 *
 * The nav delegate reports that a navigation *committed*. It cannot report *why*: from
 * WebKit's side, a url the user typed, a link the page followed, and a reload all look
 * the same. But that difference is exactly what a browsing history is about — "I typed
 * this" and "the page took me here" are different facts.
 *
 * So the commands record their intent before navigating, and the commit consumes it. It
 * is consumed exactly once: if the user types a url and the page then follows a link on
 * its own, that second navigation is not something the user typed.
 *
 * A redirect is NOT tracked here — it is a real signal from the native side
 * (`didReceiveServerRedirectForProvisionalNavigation`), because a timing heuristic would
 * mistake a fast link click for a redirect. And a redirect does not overwrite the intent
 * anyway: the user still set off by typing; the site is what redirected them.
 *
 * @coordinates-with services/browser/browserNavigation — sets the intent
 * @coordinates-with components/Browser/BrowserSurface — consumes it at commit
 * @module services/browser/navIntent
 */
import type { TransitionKind } from "@/stores/browserHistoryStore";

/** Only the kinds a VMark command can *cause*. "link" is the absence of one. */
export type NavIntent = Extract<TransitionKind, "typed" | "reload" | "back-forward">;

const intents = new Map<string, NavIntent>();

/** Record why the next navigation on this tab is happening. */
export function setNavIntent(tabId: string, intent: NavIntent): void {
  intents.set(tabId, intent);
}

/**
 * Consume the intent for a committed navigation. Defaults to "link": nothing in VMark
 * asked for it, so the page navigated itself — the overwhelmingly common case.
 */
export function takeNavIntent(tabId: string): TransitionKind {
  const intent = intents.get(tabId);
  intents.delete(tabId);
  return intent ?? "link";
}

/** Drop a tab's pending intent (tab closed, or a navigation superseded). */
export function clearNavIntent(tabId: string): void {
  intents.delete(tabId);
}
