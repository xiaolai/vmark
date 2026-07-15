/**
 * statusBarHelpers — small pure helpers extracted from StatusBar.tsx to keep it
 * under the file-size limit. Pure functions only — no store subscriptions, no JSX.
 *
 * @module components/StatusBar/statusBarHelpers
 */
import type { KeyboardEvent } from "react";
import { isBrowserTab, type Tab } from "@/stores/tabStoreTypes";

/**
 * The active tab's id iff it is a browser tab, else null.
 *
 * When set, the bottom bar shows the browser omnibox (ADR-4) in place of the
 * document-only controls — and, per the Codex re-review, the bar must render even
 * when the user has hidden the status bar, since the omnibox is the browser's only
 * chrome.
 */
export function pickActiveBrowserTabId(
  tabs: readonly Tab[],
  activeTabId: string | null,
): string | null {
  if (!activeTabId) return null;
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab && isBrowserTab(tab) ? activeTabId : null;
}

/** Off-screen style for the ARIA live region that announces drag-and-drop outcomes. */
export const ARIA_LIVE_STYLE = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
} as const;

/**
 * Prevent Cmd+A from selecting all page content when focus is on non-input
 * elements. Only prevents when the active element is a button or similar
 * non-text element.
 */
export function preventSelectAllOnButtons(event: KeyboardEvent) {
  if ((event.metaKey || event.ctrlKey) && event.key === "a") {
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
      event.preventDefault();
    }
  }
}
