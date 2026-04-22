/**
 * File Load Store
 *
 * Purpose: Tracks whether a large WYSIWYG open is currently in progress so the
 * StatusBar can show an indeterminate "Opening large file…" indicator. The
 * indicator is honestly indeterminate — once ProseMirror's view construction
 * starts, the main thread is frozen; we cannot report sub-phase progress.
 *
 * Only set when:
 *   - File size ≥ SHOW_PROGRESS_BYTES (300 KB), AND
 *   - The open is going to WYSIWYG (not Source mode, which is sub-second).
 *
 * Cleared on:
 *   - First `onTransaction` after the editor mounts with content, OR
 *   - Error path (clear on failure so no stale indicator lingers).
 *
 * @coordinates-with components/StatusBar/FileLoadIndicator.tsx — reads the state.
 * @coordinates-with hooks/useFileOpen.ts — sets/clears around WYSIWYG loads.
 * @coordinates-with hooks/useFinderFileOpen.ts — sets/clears around WYSIWYG loads.
 * @module stores/fileLoadStore
 */

import { create } from "zustand";

interface FileLoadState {
  active: boolean;
  filename: string;
  /** Bytes. Displayed via utils/fileSizeThresholds.formatFileSize. */
  sizeBytes: number;
  /** Monotonic token identifying the current load. Consumers pass it back to
   *  `endLoad(loadId)` so a stale editor-mount completion cannot clear an
   *  already-replaced indicator. */
  loadId: number;
  /** Returns the loadId of the newly started load. */
  startLoad: (filename: string, sizeBytes: number) => number;
  /**
   * Clear the indicator. When called with no argument, clears unconditionally
   * (used by error paths that already know they are the owner). When called
   * with a loadId, only clears if it matches the currently active load.
   */
  endLoad: (loadId?: number) => void;
}

export const useFileLoadStore = create<FileLoadState>((set, get) => ({
  active: false,
  filename: "",
  sizeBytes: 0,
  loadId: 0,
  startLoad: (filename, sizeBytes) => {
    const nextId = get().loadId + 1;
    set({ active: true, filename, sizeBytes, loadId: nextId });
    return nextId;
  },
  endLoad: (loadId) => {
    if (loadId !== undefined && loadId !== get().loadId) return;
    set({ active: false, filename: "", sizeBytes: 0 });
  },
}));
