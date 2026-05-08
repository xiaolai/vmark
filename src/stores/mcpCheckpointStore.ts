/**
 * Purpose: Per-MCP-write content snapshots so users can roll back AI
 *   edits at any granularity. Each successful `document.write`,
 *   `document.transform`, `workflow.apply_patch`, or `selection.set`
 *   pushes a checkpoint carrying the *before* content; the user (or AI)
 *   can restore by replaying that snapshot.
 *
 *   Replaces the safety net the deleted suggestions/auto-approve
 *   feature used to provide. See dev-docs/plans/20260504-mcp-pruning.md
 *   ADR-1 for why suggestions died, and the conversation log for why
 *   checkpoints replace them rather than reintroducing tracked-changes.
 *
 * Key decisions:
 *   - Persisted to `<appDataDir>/mcp-checkpoints.jsonl` so the history
 *     survives restart. JSONL keeps appends cheap (one fs append per
 *     write) and read-on-hydrate dead simple.
 *   - Keyed by `filePath` for files that have one, fallback to `tabId`
 *     for untitled docs. Untitled checkpoints lose their anchor when
 *     the tab closes — accepted tradeoff (the alternative is keeping
 *     orphaned untitled snapshots forever).
 *   - Two retention caps: per-anchor (50 newest checkpoints), and
 *     global byte cap (5 MiB) to bound disk usage in the long run.
 *     When either limit is exceeded the OLDEST checkpoint is dropped.
 *   - Snapshots are stored as full content (not diff). For typical
 *     Markdown docs this is bounded by the `byteSize` cap; the
 *     simplicity of direct restore beats a delta-encoding scheme.
 *
 * @coordinates-with hooks/mcpBridge/v2/document.ts — push on write/transform
 * @coordinates-with hooks/mcpBridge/v2/workflow.ts — push on apply_patch
 * @coordinates-with hooks/mcpBridge/v2/selection.ts — push on selection.set
 * @coordinates-with stores/documentStore.ts — restore via setContent
 * @coordinates-with stores/revisionStore.ts — revision bump on restore
 * @module stores/mcpCheckpointStore
 */

import { create } from "zustand";

/** Tool that produced this checkpoint. */
export type CheckpointTool =
  | "document.write"
  | "document.transform"
  | "workflow.apply_patch"
  | "selection.set";

/** A single content snapshot captured before an MCP write. */
export interface MCPCheckpoint {
  /** Unique id (`cp-` + 8 random alphanumerics). */
  id: string;
  /** Tab id at the time of capture. May not exist after restart. */
  tabId: string;
  /** Canonical file path; null for untitled docs. */
  filePath: string | null;
  /** Wall-clock time the checkpoint was pushed (ms since epoch). */
  timestamp: number;
  /** Which MCP tool produced this write. */
  tool: CheckpointTool;
  /** Human-readable summary — surfaced in the UI panel. */
  description: string;
  /** Full document content immediately *before* the MCP write. */
  contentBefore: string;
  /** Revision token immediately before the MCP write. */
  revisionBefore: string;
  /** Revision token immediately after the MCP write succeeded. */
  revisionAfter: string;
  /** Byte size of `contentBefore` (used for retention math). */
  byteSize: number;
}

/** Per-anchor (file path or tab id) cap on checkpoint count. */
export const CHECKPOINT_PER_ANCHOR_LIMIT = 50;
/** Global cap on combined contentBefore size, in bytes. */
export const CHECKPOINT_TOTAL_BYTE_LIMIT = 5 * 1024 * 1024;

interface CheckpointState {
  /** Newest-first across every anchor. */
  checkpoints: MCPCheckpoint[];
  /** True after the persisted file has been read in. */
  hydrated: boolean;
}

interface CheckpointActions {
  /**
   * Push a new checkpoint. Returns the assigned id.
   * Caller supplies metadata; the store assigns id + timestamp and
   * applies retention.
   */
  push: (
    input: Omit<MCPCheckpoint, "id" | "timestamp" | "byteSize">,
  ) => string;
  /** Get a checkpoint by id, or null. */
  get: (id: string) => MCPCheckpoint | null;
  /**
   * List checkpoints (newest first). Optional anchor filter — if both
   * fields are passed, the path-match wins (file paths are stable
   * across restart; tab ids are not).
   */
  list: (filter?: {
    filePath?: string | null;
    tabId?: string;
  }) => MCPCheckpoint[];
  /**
   * Drop checkpoints matching an anchor. Pass nothing to clear all.
   * Used by tests and by the workspace-clear flow.
   */
  clear: (filter?: { filePath?: string | null; tabId?: string }) => void;
  /**
   * Replace the in-memory state with `next`. Used during hydrate; not
   * intended for general callers.
   */
  __setAll: (next: MCPCheckpoint[]) => void;
  /** Mark hydration complete. */
  __markHydrated: () => void;
}

const RANDOM_CHARS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function generateId(): string {
  let suffix = "";
  for (let i = 0; i < 8; i++) {
    suffix += RANDOM_CHARS.charAt(
      Math.floor(Math.random() * RANDOM_CHARS.length),
    );
  }
  return `cp-${suffix}`;
}

function anchorKey(cp: { filePath: string | null; tabId: string }): string {
  return cp.filePath ?? `tab:${cp.tabId}`;
}

/**
 * Apply retention. Newest-first ordering is required on input.
 *
 * 1. Per-anchor cap: each anchor keeps at most CHECKPOINT_PER_ANCHOR_LIMIT.
 * 2. Global byte cap: if the combined `byteSize` exceeds the global
 *    limit, drop oldest entries until we're under.
 */
function applyRetention(checkpoints: MCPCheckpoint[]): MCPCheckpoint[] {
  // 1) per-anchor cap
  const seen = new Map<string, number>();
  const afterPerAnchor: MCPCheckpoint[] = [];
  for (const cp of checkpoints) {
    const key = anchorKey(cp);
    const count = seen.get(key) ?? 0;
    if (count >= CHECKPOINT_PER_ANCHOR_LIMIT) continue;
    seen.set(key, count + 1);
    afterPerAnchor.push(cp);
  }

  // 2) global byte cap — drop OLDEST until we're under.
  let total = afterPerAnchor.reduce((sum, cp) => sum + cp.byteSize, 0);
  if (total <= CHECKPOINT_TOTAL_BYTE_LIMIT) return afterPerAnchor;

  // checkpoints[] is newest-first → oldest are at the tail.
  const result = afterPerAnchor.slice();
  while (total > CHECKPOINT_TOTAL_BYTE_LIMIT && result.length > 0) {
    const dropped = result.pop();
    if (dropped) total -= dropped.byteSize;
  }
  return result;
}

/**
 * Per-MCP-write version-history store. Use selectors, not destructuring.
 */
export const useMcpCheckpointStore = create<
  CheckpointState & CheckpointActions
>((set, get) => ({
  checkpoints: [],
  hydrated: false,

  push: (input) => {
    const id = generateId();
    const cp: MCPCheckpoint = {
      ...input,
      id,
      timestamp: Date.now(),
      byteSize: input.contentBefore.length,
    };
    set((state) => ({
      checkpoints: applyRetention([cp, ...state.checkpoints]),
    }));
    return id;
  },

  get: (id) => {
    return get().checkpoints.find((cp) => cp.id === id) ?? null;
  },

  list: (filter) => {
    const all = get().checkpoints;
    if (!filter) return all;
    if (filter.filePath !== undefined) {
      const fp = filter.filePath;
      return all.filter((cp) => cp.filePath === fp);
    }
    if (filter.tabId !== undefined) {
      const tid = filter.tabId;
      // Tab-id match also matches the path-anchored entries that were
      // pushed under this tab, so the UI can show the panel for an
      // unsaved doc and still see history.
      return all.filter((cp) => cp.tabId === tid);
    }
    return all;
  },

  clear: (filter) => {
    if (!filter) {
      set({ checkpoints: [] });
      return;
    }
    set((state) => {
      const next = state.checkpoints.filter((cp) => {
        if (filter.filePath !== undefined) {
          return cp.filePath !== filter.filePath;
        }
        if (filter.tabId !== undefined) {
          return cp.tabId !== filter.tabId;
        }
        return true;
      });
      return { checkpoints: next };
    });
  },

  __setAll: (next) => set({ checkpoints: applyRetention(next) }),
  __markHydrated: () => set({ hydrated: true }),
}));
