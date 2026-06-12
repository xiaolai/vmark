/**
 * Purpose: Persist `useMcpStore` to disk so version history
 *   survives restart. Append-only JSONL keeps push cheap (one fs write
 *   per checkpoint); on hydrate we read the entire file and apply the
 *   in-memory retention to bound size.
 *
 *   Storage: `<appDataDir>/mcp-checkpoints.jsonl`. One MCPCheckpoint
 *   per line. Corrupt lines are skipped (defensive — never block app
 *   startup over a malformed history file).
 *
 * Key decisions:
 *   - Append-on-push: a true O(1) `writeTextFile(..., { append: true })`
 *     — never read-modify-write, which raced with itself and dropped
 *     lines when two MCP writes landed back to back (audit H5).
 *   - Serialized writers: every disk mutation (append/compact/clear) flows
 *     through one promise queue, so a rewrite can never interleave with
 *     an in-flight append.
 *   - Multi-window safety (audit 20260612 deferred / cross-model review):
 *     every document window is a separate webview with its OWN in-memory
 *     store and write queue, all writing this one file. So full-file
 *     rewrites must never derive solely from one window's memory — that
 *     would clobber checkpoints another window appended. Compaction
 *     therefore merges the on-disk union with in-memory before writing,
 *     and clear is a TARGETED on-disk line removal (clearCheckpointsOnDisk)
 *     rather than a rewrite-from-memory. Residual: a checkpoint appended by
 *     window A during the read→write window of B's compaction can still be
 *     lost — eliminating that needs a file lock or moving persistence to
 *     Rust (still deferred).
 *   - Rewrite-on-rehydrate: after loading, the in-memory retention
 *     compacts oldest entries; we mirror that compaction back to disk
 *     so the file doesn't grow unbounded between restarts. Hydrate also
 *     dedupes by id (newest wins) so a crash between append and rewrite
 *     can never double-count a checkpoint.
 *   - Non-blocking writes: appendCheckpoint is fire-and-forget with
 *     error logging — a failed disk write must not break the MCP path.
 *
 * @coordinates-with stores/mcpStore.ts — in-memory state
 * @module stores/mcpCheckpointPersistence
 */

import { appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  readTextFile,
  writeTextFile,
  mkdir,
} from "@tauri-apps/plugin-fs";
import {
  useMcpStore,
  type MCPCheckpoint,
} from "./mcpStore";
import { mcpBridgeError, mcpBridgeLog } from "@/utils/debug";

const FILE_NAME = "mcp-checkpoints.jsonl";

let cachedPath: string | null = null;

/**
 * Single writer queue: appends and rewrites are strictly ordered so they
 * can never interleave. Failures don't break the chain — each task runs
 * regardless of whether the previous one rejected.
 */
let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(task: () => Promise<void>): Promise<void> {
  const run = writeQueue.then(task, task);
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Read the file and return checkpoints deduped by id (newest line wins). */
async function readDedupedFromDisk(path: string): Promise<MCPCheckpoint[]> {
  if (!(await exists(path))) return [];
  const text = await readTextFile(path);
  const byId = new Map<string, MCPCheckpoint>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (isCheckpoint(parsed)) byId.set(parsed.id, parsed);
    } catch {
      // Skip malformed line; keep going.
    }
  }
  return Array.from(byId.values());
}

/** Whether a checkpoint matches a clear filter (mirrors mcpStore.checkpointClear). */
function matchesClearFilter(
  cp: MCPCheckpoint,
  filter?: { filePath?: string | null; tabId?: string },
): boolean {
  if (!filter) return true;
  if (filter.filePath !== undefined) return cp.filePath === filter.filePath;
  if (filter.tabId !== undefined) return cp.tabId === filter.tabId;
  return true;
}

async function resolvePath(): Promise<string> {
  if (cachedPath !== null) return cachedPath;
  const dir = await appDataDir();
  // appDataDir is created lazily by Tauri; ensure it's there before
  // first write so our append doesn't fail on a brand-new install.
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // Directory may already exist — Tauri's mkdir doesn't expose a
    // dedicated "already exists" code; ignore and let the read/write
    // surface real errors.
  }
  cachedPath = await join(dir, FILE_NAME);
  return cachedPath;
}

/**
 * Read the persisted file and seed the store. Safe to call multiple
 * times; subsequent calls noop after the first successful hydrate.
 */
export async function hydrateCheckpoints(): Promise<void> {
  if (useMcpStore.getState().checkpoint.hydrated) return;
  try {
    const path = await resolvePath();
    const checkpoints = await readDedupedFromDisk(path);
    // Sort newest-first to match the store's invariant.
    checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    useMcpStore.getState().checkpointSetAll(checkpoints);

    // Compact the file back to the retained state so it doesn't grow
    // unbounded between restarts.
    await rewriteAll();
  } catch (error) {
    mcpBridgeError("Failed to hydrate MCP checkpoints:", error);
  } finally {
    useMcpStore.getState().checkpointMarkHydrated();
  }
}

/**
 * Append one checkpoint to the persisted log. Fire-and-forget — errors
 * are logged but never thrown. Call this AFTER the in-memory push so
 * the store's id/timestamp are settled.
 *
 * Uses a true filesystem append (no read-modify-write) and the shared
 * writer queue, so concurrent MCP writes can never drop each other's
 * lines (audit H5).
 */
export async function appendCheckpoint(
  cp: MCPCheckpoint,
): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const path = await resolvePath();
      await writeTextFile(path, JSON.stringify(cp) + "\n", { append: true });
      mcpBridgeLog("Appended checkpoint", cp.id, cp.tool);
    } catch (error) {
      mcpBridgeError("Failed to append MCP checkpoint:", error);
    }
  });
}

/**
 * Compact the persisted file: merge the on-disk union with the in-memory
 * checkpoints (so checkpoints another window appended are preserved, not
 * clobbered), apply retention via the store, and write the result. Used
 * after hydrate compaction. Queued behind any in-flight appends.
 *
 * NOT used for clear — clearing removes ids from memory, and re-merging
 * disk would resurrect them; clear goes through clearCheckpointsOnDisk.
 */
export async function rewriteAll(): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const path = await resolvePath();
      // Union disk + memory by id so a concurrent append from another
      // window is not dropped by this compaction (multi-window safety).
      const merged = new Map<string, MCPCheckpoint>();
      for (const cp of await readDedupedFromDisk(path)) merged.set(cp.id, cp);
      for (const cp of useMcpStore.getState().checkpoint.checkpoints) {
        merged.set(cp.id, cp);
      }
      const union = Array.from(merged.values()).sort(
        (a, b) => b.timestamp - a.timestamp,
      );
      // Apply retention through the single source of truth, then mirror the
      // retained set to disk. This also converges this window's in-memory
      // view with checkpoints other windows wrote.
      useMcpStore.getState().checkpointSetAll(union);
      const retained = useMcpStore.getState().checkpoint.checkpoints;
      const lines = retained.map((cp) => JSON.stringify(cp)).join("\n");
      await writeTextFile(path, lines.length > 0 ? lines + "\n" : "");
    } catch (error) {
      mcpBridgeError("Failed to rewrite MCP checkpoint log:", error);
    }
  });
}

/**
 * Remove checkpoints matching `filter` from the persisted file in place,
 * preserving every other line — including checkpoints other windows
 * appended that this window never had in memory (multi-window safety;
 * audit 20260612 deferred). Mirrors mcpStore.checkpointClear's filter
 * semantics. Queued behind in-flight appends.
 */
export async function clearCheckpointsOnDisk(filter?: {
  filePath?: string | null;
  tabId?: string;
}): Promise<void> {
  return enqueueWrite(async () => {
    try {
      const path = await resolvePath();
      if (!(await exists(path))) return;
      const text = await readTextFile(path);
      const kept: string[] = [];
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          continue; // drop malformed
        }
        if (!isCheckpoint(parsed)) continue; // drop malformed
        if (matchesClearFilter(parsed, filter)) continue; // cleared
        kept.push(trimmed);
      }
      await writeTextFile(path, kept.length > 0 ? kept.join("\n") + "\n" : "");
    } catch (error) {
      mcpBridgeError("Failed to clear MCP checkpoints on disk:", error);
    }
  });
}

function isCheckpoint(value: unknown): value is MCPCheckpoint {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    typeof o.tabId === "string" &&
    (o.filePath === null || typeof o.filePath === "string") &&
    typeof o.timestamp === "number" &&
    typeof o.tool === "string" &&
    typeof o.description === "string" &&
    typeof o.contentBefore === "string" &&
    typeof o.revisionBefore === "string" &&
    typeof o.revisionAfter === "string" &&
    typeof o.byteSize === "number"
  );
}
