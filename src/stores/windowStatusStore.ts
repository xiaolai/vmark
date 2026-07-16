/**
 * Window status store (#1057).
 *
 * Holds the cross-window status snapshot the Rust registry broadcasts on
 * `window-status:changed`. Any window's Window-Status panel reads this to list
 * every open window with its live Claude Code status and jump to it.
 *
 * The data is owned by Rust (`src-tauri/src/window_status`); this store is a
 * passive mirror — `useWindowStatus` seeds it via `get_window_statuses`
 * and keeps it current from the broadcast. Components MUST use selectors.
 *
 * @coordinates-with src-tauri/src/window_status/mod.rs — source of truth
 * @module stores/windowStatusStore
 */
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { windowStatusScopedStorage } from "@/services/persistence/windowStatusStorage";

/** VMark AI-genie invocation state for a window (mirrors the Rust `ai` field). */
export type WindowAiStatus = "idle" | "running" | "error";

export interface WindowStatusEntry {
  label: string;
  docName: string;
  ai: WindowAiStatus;
  elapsedSeconds: number;
  /** A terminal bell rang while the window was unfocused; cleared on focus. */
  attention: boolean;
}

interface WindowStatusState {
  windows: WindowStatusEntry[];
  /** Whether the Window-Status panel is open in THIS window. */
  panelOpen: boolean;
  /**
   * Whether the panel is pinned. When pinned, jumping to a window focuses it
   * but leaves the panel open, so the panel works as persistent "mission
   * control" across many windows (#1120).
   */
  pinned: boolean;
  setWindows: (windows: WindowStatusEntry[]) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
  reset: () => void;
}

export const useWindowStatusStore = create<WindowStatusState>()(
  persist(
    (set) => ({
      windows: [],
      panelOpen: false,
      pinned: false,
      setWindows: (windows) => set({ windows }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      togglePinned: () => set((s) => ({ pinned: !s.pinned })),
      setPinned: (pinned) => set({ pinned }),
      reset: () => set({ windows: [], panelOpen: false, pinned: false }),
    }),
    {
      // Name is ignored by windowStatusScopedStorage (keys by window label).
      name: "vmark-window-status",
      storage: createJSONStorage(() => windowStatusScopedStorage),
      // Persist ONLY the user's panel preferences. `windows` is Rust-owned
      // live data re-seeded each session — persisting it would resurrect a
      // stale snapshot on reload.
      partialize: (s) => ({ panelOpen: s.panelOpen, pinned: s.pinned }),
      // useWindowStatus rehydrates on mount — after WindowContext has set the
      // window label — so each window reads from its own key (like workspace).
      skipHydration: true,
    },
  ),
);

/* Selectors — components MUST use these (no store destructuring). */
export const selectWindows = (s: WindowStatusState): WindowStatusEntry[] => s.windows;
export const selectPanelOpen = (s: WindowStatusState): boolean => s.panelOpen;
export const selectPinned = (s: WindowStatusState): boolean => s.pinned;

/**
 * Windows other than the given label, sorted attention-first then running, so
 * the ones that need the user surface at the top of the panel.
 */
export function selectOtherWindowsRanked(
  windows: WindowStatusEntry[],
  selfLabel: string,
): WindowStatusEntry[] {
  const rank = (w: WindowStatusEntry): number => {
    if (w.attention) return 0;
    if (w.ai === "error") return 1;
    if (w.ai === "running") return 2;
    return 3;
  };
  return windows
    .filter((w) => w.label !== selfLabel)
    .sort((a, b) => rank(a) - rank(b) || a.docName.localeCompare(b.docName));
}
