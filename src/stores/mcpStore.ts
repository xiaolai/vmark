/**
 * MCP Store — T09 consolidation.
 *
 * Merges three legacy stores behind one Zustand store with namespaced
 * slices (s.checkpoint / s.health / s.update). Their action names are
 * domain-prefixed to disambiguate.
 *
 * - mcpCheckpointStore → state.checkpoint + checkpoint* actions
 * - mcpHealthStore     → state.health + setHealth / setIsChecking / resetHealth
 * - updateStore        → state.update + update* actions
 *
 * The persistence module `mcpCheckpointPersistence.ts` is kept as a
 * helper (it imports the new store), since it is not itself a Zustand
 * store.
 *
 * @module stores/mcpStore
 */

import { create } from "zustand";
import type { Update } from "@tauri-apps/plugin-updater";

/* ─────────────────────────── checkpoint slice ─────────────────────────── */

export type CheckpointTool =
  | "document.write"
  | "document.transform"
  | "workflow.apply_patch"
  | "selection.set";

export interface MCPCheckpoint {
  id: string;
  tabId: string;
  filePath: string | null;
  timestamp: number;
  tool: CheckpointTool;
  description: string;
  contentBefore: string;
  revisionBefore: string;
  revisionAfter: string;
  byteSize: number;
}

export const CHECKPOINT_PER_ANCHOR_LIMIT = 50;
export const CHECKPOINT_TOTAL_BYTE_LIMIT = 5 * 1024 * 1024;

interface CheckpointSlice {
  checkpoints: MCPCheckpoint[];
  hydrated: boolean;
}

const initialCheckpoint: CheckpointSlice = {
  checkpoints: [],
  hydrated: false,
};

const RANDOM_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateCheckpointId(): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += RANDOM_CHARS.charAt(Math.floor(Math.random() * RANDOM_CHARS.length));
  }
  return `cp-${suffix}`;
}

function anchorKey(cp: { filePath: string | null; tabId: string }): string {
  return cp.filePath ?? `tab:${cp.tabId}`;
}

function applyRetention(checkpoints: MCPCheckpoint[]): MCPCheckpoint[] {
  const seen = new Map<string, number>();
  const afterPerAnchor: MCPCheckpoint[] = [];
  for (const cp of checkpoints) {
    const key = anchorKey(cp);
    const count = seen.get(key) ?? 0;
    if (count >= CHECKPOINT_PER_ANCHOR_LIMIT) continue;
    seen.set(key, count + 1);
    afterPerAnchor.push(cp);
  }

  let total = afterPerAnchor.reduce((sum, cp) => sum + cp.byteSize, 0);
  if (total <= CHECKPOINT_TOTAL_BYTE_LIMIT) return afterPerAnchor;

  const result = afterPerAnchor.slice();
  while (total > CHECKPOINT_TOTAL_BYTE_LIMIT && result.length > 0) {
    const dropped = result.pop();
    if (dropped) total -= dropped.byteSize;
  }
  return result;
}

/* ─────────────────────────── health slice ─────────────────────────────── */

export interface McpHealthInfo {
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
  checkpoint: CheckpointSlice;
  health: HealthSlice;
  update: UpdateSlice;
}

interface McpStoreActions {
  /* checkpoint actions */
  checkpointPush: (
    input: Omit<MCPCheckpoint, "id" | "timestamp" | "byteSize">,
  ) => string;
  checkpointGet: (id: string) => MCPCheckpoint | null;
  checkpointList: (filter?: {
    filePath?: string | null;
    tabId?: string;
  }) => MCPCheckpoint[];
  checkpointClear: (filter?: { filePath?: string | null; tabId?: string }) => void;
  /** Internal: replace state from disk on hydrate. */
  checkpointSetAll: (next: MCPCheckpoint[]) => void;
  checkpointMarkHydrated: () => void;

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

export const useMcpStore = create<McpStore>((set, get) => ({
  checkpoint: initialCheckpoint,
  health: initialHealth,
  update: initialUpdate,

  /* checkpoint slice */
  checkpointPush: (input) => {
    const id = generateCheckpointId();
    const cp: MCPCheckpoint = {
      ...input,
      id,
      timestamp: Date.now(),
      byteSize: input.contentBefore.length,
    };
    set((s) => ({
      checkpoint: {
        ...s.checkpoint,
        checkpoints: applyRetention([cp, ...s.checkpoint.checkpoints]),
      },
    }));
    return id;
  },
  checkpointGet: (id) =>
    get().checkpoint.checkpoints.find((cp) => cp.id === id) ?? null,
  checkpointList: (filter) => {
    const all = get().checkpoint.checkpoints;
    if (!filter) return all;
    if (filter.filePath !== undefined) {
      const fp = filter.filePath;
      return all.filter((cp) => cp.filePath === fp);
    }
    if (filter.tabId !== undefined) {
      const tid = filter.tabId;
      return all.filter((cp) => cp.tabId === tid);
    }
    return all;
  },
  checkpointClear: (filter) => {
    if (!filter) {
      set((s) => ({ checkpoint: { ...s.checkpoint, checkpoints: [] } }));
      return;
    }
    set((s) => {
      const next = s.checkpoint.checkpoints.filter((cp) => {
        if (filter.filePath !== undefined) {
          return cp.filePath !== filter.filePath;
        }
        if (filter.tabId !== undefined) {
          return cp.tabId !== filter.tabId;
        }
        return true;
      });
      return { checkpoint: { ...s.checkpoint, checkpoints: next } };
    });
  },
  checkpointSetAll: (next) =>
    set((s) => ({
      checkpoint: { ...s.checkpoint, checkpoints: applyRetention(next) },
    })),
  checkpointMarkHydrated: () =>
    set((s) => ({ checkpoint: { ...s.checkpoint, hydrated: true } })),

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

/* Dev helper retained from legacy updateStore */
/* v8 ignore next 3 -- @preserve false branch is production-only; tests always run in DEV mode */
if (import.meta.env.DEV) {
  (window as unknown as { __mcpStore: typeof useMcpStore }).__mcpStore =
    useMcpStore;
}
