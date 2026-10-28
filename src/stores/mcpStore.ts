/**
 * MCP Store — T09 consolidation.
 *
 * Merges the legacy stores behind one Zustand store with namespaced
 * slices (s.health / s.update). Their action names are domain-prefixed to
 * disambiguate.
 *
 * - mcpHealthStore     → state.health + setHealth / setIsChecking / resetHealth
 * - updateStore        → state.update + update* actions
 *
 * The checkpoint slice is retired: agent writes are kept by the agent edit
 * journal, and the history panel reads the journal directly
 * (`components/McpHistory/`).
 *
 * @module stores/mcpStore
 */

import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";
import { publishDevGlobal } from "@/utils/devDebugHandle";

/* ─────────────────────────── health slice ─────────────────────────────── */

interface McpHealthInfo {
  version: string | null;
  toolCount: number | null;
  resourceCount: number | null;
  tools: string[];
  lastChecked: Date | null;
  checkError: string | null;
}

interface HealthSlice {
  health: McpHealthInfo;
  isChecking: boolean;
}

const initialHealthInfo: McpHealthInfo = {
  version: null,
  toolCount: null,
  resourceCount: null,
  tools: [],
  lastChecked: null,
  checkError: null,
};

const initialHealth: HealthSlice = {
  health: initialHealthInfo,
  isChecking: false,
};

/* ─────────────────────────── update slice ─────────────────────────────── */

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading" | "installing"
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

interface UpdateSlice {
  status: UpdateStatus;
  updateInfo: UpdateInfo | null;
  downloadProgress: DownloadProgress | null;
  error: string | null;
  dismissed: boolean;
  pendingUpdate: Update | null;
}

const initialUpdate: UpdateSlice = {
  status: "idle",
  updateInfo: null,
  downloadProgress: null,
  error: null,
  dismissed: false,
  pendingUpdate: null,
};

type ProgressUpdater =
  | DownloadProgress
  | null
  | ((prev: DownloadProgress | null) => DownloadProgress | null);

/* ─────────────────────────── store shape ──────────────────────────────── */

interface McpStoreState {
  health: HealthSlice;
  update: UpdateSlice;
}

interface McpStoreActions {
  /* health actions */
  setHealth: (health: Partial<McpHealthInfo>) => void;
  setIsChecking: (checking: boolean) => void;
  resetHealth: () => void;

  /* update actions */
  setUpdateStatus: (status: UpdateStatus) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
  setDownloadProgress: (progress: ProgressUpdater) => void;
  setUpdateError: (error: string | null) => void;
  setPendingUpdate: (update: Update | null) => void;
  dismissUpdate: () => void;
  clearDismissed: () => void;
  resetUpdate: () => void;
}

export type McpStore = McpStoreState & McpStoreActions;

/* ────────────────────────────── factory ───────────────────────────────── */

export const useMcpStore = create<McpStore>((set) => ({
  health: initialHealth,
  update: initialUpdate,

  /* health slice */
  setHealth: (health) =>
    set((s) => ({
      health: { ...s.health, health: { ...s.health.health, ...health } },
    })),
  setIsChecking: (isChecking) =>
    set((s) => ({ health: { ...s.health, isChecking } })),
  resetHealth: () => set({ health: initialHealth }),

  /* update slice */
  setUpdateStatus: (status) =>
    set((s) => ({
      update: {
        ...s.update,
        status,
        error: status === "error" ? s.update.error : null,
      },
    })),
  setUpdateInfo: (updateInfo) =>
    set((s) => ({ update: { ...s.update, updateInfo } })),
  setDownloadProgress: (progress) =>
    set((s) => ({
      update: {
        ...s.update,
        downloadProgress:
          typeof progress === "function"
            ? progress(s.update.downloadProgress)
            : progress,
      },
    })),
  setUpdateError: (error) =>
    set((s) => ({
      update: {
        ...s.update,
        error,
        status: error !== null ? "error" : s.update.status,
      },
    })),
  setPendingUpdate: (pendingUpdate) =>
    set((s) => ({ update: { ...s.update, pendingUpdate } })),
  dismissUpdate: () => set((s) => ({ update: { ...s.update, dismissed: true } })),
  clearDismissed: () => set((s) => ({ update: { ...s.update, dismissed: false } })),
  resetUpdate: () => set({ update: initialUpdate }),
}));

/* Dev helper retained from legacy updateStore (DEV-gated inside publishDevGlobal). */
publishDevGlobal("__mcpStore", useMcpStore);
