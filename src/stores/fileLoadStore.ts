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
  startLoad: (filename: string, sizeBytes: number) => void;
  endLoad: () => void;
}

export const useFileLoadStore = create<FileLoadState>((set) => ({
  active: false,
  filename: "",
  sizeBytes: 0,
  startLoad: (filename, sizeBytes) => set({ active: true, filename, sizeBytes }),
  endLoad: () => set({ active: false, filename: "", sizeBytes: 0 }),
}));
