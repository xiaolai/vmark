/**
 * In-flight file-load coordination — UI indicator for the active large-file
 * read. The monotonic `loadId` token prevents a stale completion from
 * clearing an indicator that a newer load already replaced.
 *
 * @module stores/documentStore/fileLoad
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
