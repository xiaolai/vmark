/**
 * browserWorkspaceActive — is the focused tab in a window a browser tab?
 *
 * Lives in `services/` rather than beside the React hook because its consumers
 * are not all React: the terminal's store sync reads it from a plain zustand
 * subscriber to decide whether xterm should paint the neutral palette (see
 * theme/terminalThemeForBrowser.ts). A non-React store read is a service, not a
 * component concern (ADR-013) — and putting it here keeps `components/Terminal`
 * from importing `components/Browser`, which would be a cross-feature edge for
 * what is really a question about tab state.
 *
 * @coordinates-with components/Browser/useBrowserWorkspaceState.ts — the React hook
 * @coordinates-with components/Terminal/terminalSessionStoreSync.ts — imperative consumer
 * @module services/browser/browserWorkspaceActive
 */

import { useTabStore } from "@/stores/tabStore";

const EMPTY_TABS: never[] = [];

/**
 * Pure predicate. Exported so the hook and the imperative reader below share one
 * definition and cannot drift into disagreeing about what "browser is active"
 * means.
 */
export function browserTabIsActive(
  tabs: readonly { id: string; kind?: string }[],
  activeTabId: string | null | undefined,
): boolean {
  return !!activeTabId && tabs.some((t) => t.id === activeTabId && t.kind === "browser");
}

/** Imperative read for subscribers that run outside React. */
export function getBrowserWorkspaceActive(windowLabel: string): boolean {
  const state = useTabStore.getState();
  return browserTabIsActive(state.tabs[windowLabel] ?? EMPTY_TABS, state.activeTabId[windowLabel]);
}
