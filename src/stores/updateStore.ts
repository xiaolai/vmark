/**
 * Update Store
 *
 * Manages update status, progress, and error state for the auto-update feature.
 */

import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error"
  | "up-to-date";

export interface UpdateInfo {
  version: string;
  notes: string;
  pubDate: string;
  currentVersion: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

interface UpdateState {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: string | null;
  dismissed: boolean; // User dismissed the notification banner
  pendingUpdate: Update | null; // The actual Update object for download/install
}

type ProgressUpdater = DownloadProgress | null | ((prev: DownloadProgress | null) => DownloadProgress | null);

interface UpdateActions {
  setStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setDownloadProgress: (progress: ProgressUpdater) => void;
  setError: (error: string | null) => void;
  setPendingUpdate: (update: Update | null) => void;
  dismiss: () => void;
  clearDismissed: () => void;
  reset: () => void;
}

const initialState: UpdateState = {
  status: "idle",
  updateInfo: null,
  downloadProgress: null,
  error: null,
  dismissed: false,
  pendingUpdate: null,
};

export const useUpdateStore = create<UpdateState & UpdateActions>()((set) => ({
  ...initialState,

  // setStatus clears error when transitioning away from error state
  // but preserves error when status is "error" (let setError handle error messages)
  setStatus: (status) =>
    set((state) => ({
      status,
      // Clear error when moving to non-error status, preserve when staying in error
      error: status === "error" ? state.error : null,
    })),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setDownloadProgress: (progress) =>
    set((state) => ({
      downloadProgress:
        typeof progress === "function" ? progress(state.downloadProgress) : progress,
    })),
  // setError: null clears error without changing status, non-null sets error status
  setError: (error) =>
    set((state) => ({
      error,
      status: error !== null ? "error" : state.status,
    })),
  setPendingUpdate: (pendingUpdate) => set({ pendingUpdate }),
  dismiss: () => set({ dismissed: true }),
  clearDismissed: () => set({ dismissed: false }),
  reset: () => set(initialState),
}));
