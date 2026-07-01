/**
 * PaneContext — identifies which split pane a subtree renders in (#1081).
 *
 * Wraps each pane's editor subtree so that pane-scoped hooks resolve THIS
 * pane's document rather than the window's focused tab. `useActiveTabId()`
 * (and everything derived from it) reads this context first; outside any pane
 * it falls back to the focused pane's tab. This keeps the ~dozen `useDocument*`
 * consumers unchanged while making them pane-aware (plan ADR-2).
 *
 * @coordinates-with hooks/useDocumentState.ts — useActiveTabId reads this
 * @coordinates-with stores/paneStore.ts — pane layout/focus
 * @module contexts/PaneContext
 */
import { createContext, useContext, type ReactNode } from "react";
import type { PaneId } from "@/stores/paneStore";

export interface PaneContextValue {
  paneId: PaneId;
  /** The document shown in this pane (null ⇒ empty pane). */
  tabId: string | null;
}

const PaneContext = createContext<PaneContextValue | null>(null);

export function PaneProvider({
  value,
  children,
}: {
  value: PaneContextValue;
  children: ReactNode;
}) {
  return <PaneContext.Provider value={value}>{children}</PaneContext.Provider>;
}

/** The current pane, or null when not rendered inside a specific pane. */
export function usePaneContext(): PaneContextValue | null {
  return useContext(PaneContext);
}
