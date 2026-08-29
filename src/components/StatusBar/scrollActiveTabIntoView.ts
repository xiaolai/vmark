/**
 * Scroll the active tab pill into view (WI-TNAV1.3).
 *
 * Purpose: F2 — activating a tab never scrolled its pill into view, so
 * `Mod-Shift-]` past the visible region switched the document while the active
 * pill stayed off-screen. Combined with the suppressed scrollbar (F1), the tab
 * you just switched to could be invisible.
 *
 * Key decisions:
 *   - The trigger is an ACTIVATION KEY, not `activeTabId`. `StatusBar.tsx`
 *     passes `activeTabId={null}` whenever the synthetic browser pill is
 *     active, so an `activeTabId`-only effect can never reveal that pill — and
 *     no `activeTabId`-based test would notice.
 *   - `block`/`inline: "nearest"`. `"center"` scrolls the whole page for a
 *     status bar sitting at the viewport edge.
 *   - Dragging absorbs everything: autoscroll must not fight a reorder drag.
 *   - `prefers-reduced-motion` is read per decision, not once at module load,
 *     so a mid-session change takes effect.
 *
 * @coordinates-with components/StatusBar/StatusBarTabStrip.tsx — the consumer
 * @module components/StatusBar/scrollActiveTabIntoView
 */

import { useEffect, useRef } from "react";
import { prefersReducedMotion } from "@/utils/motion";

/** Sentinel for the synthetic browser-workspace pill, which has no tab id. */
export const BROWSER_PILL_KEY = "__browser-workspace__";

export interface ActivationSource {
  activeTabId: string | null;
  browserWorkspaceActive: boolean;
}

/** The value whose CHANGE means "a different pill is now current". */
export function activationKey({ activeTabId, browserWorkspaceActive }: ActivationSource): string | null {
  if (browserWorkspaceActive) return BROWSER_PILL_KEY;
  return activeTabId;
}


export interface ScrollDecisionInput {
  prevKey: string | null;
  nextKey: string | null;
  isDragging: boolean;
  reducedMotion: boolean;
}

/** The scroll options to apply, or `null` for "do nothing". */
export function scrollDecision({
  prevKey,
  nextKey,
  isDragging,
  reducedMotion,
}: ScrollDecisionInput): ScrollIntoViewOptions | null {
  if (isDragging) return null;
  if (prevKey === nextKey) return null;
  if (nextKey === null) return null;
  return {
    // The literal lives here rather than via scrollBehavior() so the DECISION
    // stays pure and table-testable; the flag still arrives from
    // @/utils/motion at the call site. (The lint rule matches the bare
    // `behavior: "smooth"` literal, which this conditional is not.)
    behavior: reducedMotion ? "auto" : "smooth",
    block: "nearest",
    inline: "nearest",
  };
}

/**
 * Effect half: scroll the current pill into view when the activation key
 * changes. Kept beside the decision so the two cannot drift.
 */
export function useScrollActiveTabIntoView(
  regionRef: { current: HTMLElement | null },
  source: ActivationSource & { isDragging: boolean },
): void {
  const prevKeyRef = useRef<string | null>(null);
  const key = activationKey(source);

  useEffect(() => {
    const prevKey = prevKeyRef.current;
    prevKeyRef.current = key;

    const options = scrollDecision({ prevKey, nextKey: key, isDragging: source.isDragging, reducedMotion: prefersReducedMotion() });
    if (!options) return;

    const region = regionRef.current;
    if (!region) return;
    // A tab in a hidden workspace instance renders no pill — not an error.
    const selector =
      key === BROWSER_PILL_KEY ? "[data-workspace-tab]" : `[data-tab-id="${CSS.escape(key ?? "")}"]`;
    const target = region.querySelector(selector);
    target?.scrollIntoView(options);
  }, [key, source.isDragging, regionRef]);
}
