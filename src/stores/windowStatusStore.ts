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

import {
  windowStatusScopedStorage,
  getGlobalPinPref,
  setGlobalPinPref,
} from "@/services/persistence/windowStatusStorage";

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
   * Whether the panel is pinned in THIS window. When pinned, jumping to a
   * window focuses it but leaves the panel open, so the panel works as
   * persistent "mission control" across many windows (#1120).
   */
  pinned: boolean;
  /**
   * App-global pin (#1135): when true, every window — including windows opened
   * later — auto-opens the panel and behaves as pinned, so the "mission
   * control" layout is opt-in once rather than per-window. Persisted app-wide
   * (not window-scoped) and propagated live across windows by a Tauri event;
   * turning it off reverts each window to its own `pinned` state.
   */
  globalPin: boolean;
  setWindows: (windows: WindowStatusEntry[]) => void;
  togglePanel: () => void;
  setPanelOpen: (open: boolean) => void;
  togglePinned: () => void;
  setPinned: (pinned: boolean) => void;
  /**
   * Set the app-global pin and persist it app-wide. Enabling also opens this
   * window's panel so the layout appears immediately; the caller broadcasts the
   * change so other windows follow.
   */
  setGlobalPin: (globalPin: boolean) => void;
  reset: () => void;
}

export const useWindowStatusStore = create<WindowStatusState>()(
  persist(
    (set) => ({
      windows: [],
      panelOpen: false,
      pinned: false,
      // Seeded from the app-global store so a NEW window already knows the
      // "pin all windows" state before it renders (#1135). localStorage is
      // shared across windows, so this reads the value any window last wrote.
      globalPin: getGlobalPinPref(),
      setWindows: (windows) => set({ windows }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
      togglePinned: () => set((s) => ({ pinned: !s.pinned })),
      setPinned: (pinned) => set({ pinned }),
      setGlobalPin: (globalPin) => {
        setGlobalPinPref(globalPin);
        // Enabling opens this window's panel immediately; disabling leaves the
        // panel as-is so each window falls back to its own state (#1135).
        set(globalPin ? { globalPin, panelOpen: true } : { globalPin });
      },
      reset: () => {
        setGlobalPinPref(false);
        set({ windows: [], panelOpen: false, pinned: false, globalPin: false });
      },
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
export const selectGlobalPin = (s: WindowStatusState): boolean => s.globalPin;
/**
 * Effective pin: the panel behaves pinned when EITHER this window is pinned or
 * the app-global pin is on (#1135). Drives keep-open-on-jump and the pin
 * button's active look.
 */
export const selectEffectivePinned = (s: WindowStatusState): boolean =>
  s.globalPin || s.pinned;

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
