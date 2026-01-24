/**
 * Update Store
 *
 * Manages update status, progress, and error state for the auto-update feature.
 */

import { create } from "zustand";

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
}

type ProgressUpdater = DownloadProgress | null | ((prev: DownloadProgress | null) => DownloadProgress | null);

interface UpdateActions {
  setStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setDownloadProgress: (progress: ProgressUpdater) => void;
  setError: (error: string | null) => void;
  dismiss: () => void;
  reset: () => void;
}

const initialState: UpdateState = {
  status: "idle",
  updateInfo: null,
  downloadProgress: null,
  error: null,
  dismissed: false,
};

export const useUpdateStore = create<UpdateState & UpdateActions>()((set) => ({
  ...initialState,

  setStatus: (status) => set({ status, error: status === "error" ? undefined : null }),
  setUpdateInfo: (updateInfo) => set({ updateInfo }),
  setDownloadProgress: (progress) =>
    set((state) => ({
      downloadProgress:
        typeof progress === "function" ? progress(state.downloadProgress) : progress,
    })),
  setError: (error) => set({ error, status: "error" }),
  dismiss: () => set({ dismissed: true }),
  reset: () => set(initialState),
}));
