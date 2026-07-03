/**
 * Quick Look Store — Finder-style spacebar preview overlay.
 *
 * Purpose: Tracks whether the full-screen Quick Look overlay is open, which
 *   absolute file path it is previewing, and the ordered sibling list it can
 *   arrow through (prev/next), Finder-style. Empty/whitespace paths are ignored
 *   so the overlay never opens on nothing.
 *
 * @coordinates-with components/QuickLook/QuickLookOverlay.tsx — renders the overlay
 * @coordinates-with components/Sidebar/FileExplorer/useQuickLookHotkey.ts — spacebar trigger + sibling list
 * @module stores/quickLookStore
 */

import { create } from "zustand";

interface QuickLookState {
  /** Whether the overlay is visible. */
  isOpen: boolean;
  /** Absolute path of the file being previewed, or null when closed. */
  path: string | null;
  /** Ordered navigable file paths (arrow keys step through these). */
  siblings: string[];
  /** Index of `path` within `siblings` (-1 when closed). */
  index: number;
  /**
   * Open (or retarget) the overlay for an absolute file path. `siblings` is the
   * ordered list of files to arrow through; when omitted, or when `path` is not
   * in it, the target becomes a singleton. No-op on blank input.
   */
  open: (path: string, siblings?: string[]) => void;
  /** Move to the next sibling (clamped at the end — no wrap). */
  next: () => void;
  /** Move to the previous sibling (clamped at the start — no wrap). */
  prev: () => void;
  /** Close the overlay and clear all navigation state. */
  close: () => void;
}

/** Store managing the Quick Look preview overlay. */
export const useQuickLookStore = create<QuickLookState>()((set, get) => ({
  isOpen: false,
  path: null,
  siblings: [],
  index: -1,
  open: (path: string, siblings?: string[]) => {
    // Guard: never open on an empty/whitespace path (nothing to preview).
    if (path.trim().length === 0) return;
    const list = siblings ?? [];
    const found = list.indexOf(path);
    // Fall back to a singleton list when no siblings were given, or the target
    // isn't in the provided list — keeps the `path === siblings[index]` invariant.
    if (found === -1) {
      set({ isOpen: true, path, siblings: [path], index: 0 });
      return;
    }
    // Copy the caller's array so later external mutation can't leak into state.
    set({ isOpen: true, path, siblings: [...list], index: found });
  },
  next: () => {
    const { isOpen, siblings, index } = get();
    if (!isOpen || index >= siblings.length - 1) return;
    const nextIndex = index + 1;
    set({ index: nextIndex, path: siblings[nextIndex] });
  },
  prev: () => {
    const { isOpen, siblings, index } = get();
    if (!isOpen || index <= 0) return;
    const prevIndex = index - 1;
    set({ index: prevIndex, path: siblings[prevIndex] });
  },
  close: () => set({ isOpen: false, path: null, siblings: [], index: -1 }),
}));
