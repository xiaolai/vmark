/**
 * Purpose: Persist `useMcpCheckpointStore` to disk so version history
 *   survives restart. Append-only JSONL keeps push cheap (one fs write
 *   per checkpoint); on hydrate we read the entire file and apply the
 *   in-memory retention to bound size.
 *
 *   Storage: `<appDataDir>/mcp-checkpoints.jsonl`. One MCPCheckpoint
 *   per line. Corrupt lines are skipped (defensive — never block app
 *   startup over a malformed history file).
 *
 * Key decisions:
 *   - Append-on-push: minimal latency in the hot path.
 *   - Rewrite-on-rehydrate: after loading, the in-memory retention
 *     compacts oldest entries; we mirror that compaction back to disk
 *     so the file doesn't grow unbounded between restarts.
 *   - Non-blocking writes: appendCheckpoint is fire-and-forget with
 *     error logging — a failed disk write must not break the MCP path.
 *
 * @coordinates-with stores/mcpCheckpointStore.ts — in-memory state
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
  useMcpCheckpointStore,
  type MCPCheckpoint,
} from "./mcpCheckpointStore";
import { mcpBridgeError, mcpBridgeLog } from "@/utils/debug";

const FILE_NAME = "mcp-checkpoints.jsonl";

let cachedPath: string | null = null;

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
  if (useMcpCheckpointStore.getState().hydrated) return;
  try {
    const path = await resolvePath();
    let text = "";
    if (await exists(path)) {
      text = await readTextFile(path);
    }
    const checkpoints: MCPCheckpoint[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (isCheckpoint(parsed)) {
          checkpoints.push(parsed);
        }
      } catch {
        // Skip malformed line; keep going.
      }
    }
    // Sort newest-first to match the store's invariant.
    checkpoints.sort((a, b) => b.timestamp - a.timestamp);
    useMcpCheckpointStore.getState().__setAll(checkpoints);

    // Compact the file back to the in-memory state so retention
    // applied on hydrate also lands on disk.
    await rewriteAll();
  } catch (error) {
    mcpBridgeError("Failed to hydrate MCP checkpoints:", error);
  } finally {
    useMcpCheckpointStore.getState().__markHydrated();
  }
}

/**
 * Append one checkpoint to the persisted log. Fire-and-forget — errors
 * are logged but never thrown. Call this AFTER the in-memory push so
 * the store's id/timestamp are settled.
 */
export async function appendCheckpoint(
  cp: MCPCheckpoint,
): Promise<void> {
  try {
    const path = await resolvePath();
    let existing = "";
    if (await exists(path)) {
      existing = await readTextFile(path);
    }
    const next = existing.endsWith("\n") || existing === ""
      ? existing + JSON.stringify(cp) + "\n"
      : existing + "\n" + JSON.stringify(cp) + "\n";
    await writeTextFile(path, next);
    mcpBridgeLog("Appended checkpoint", cp.id, cp.tool);
  } catch (error) {
    mcpBridgeError("Failed to append MCP checkpoint:", error);
  }
}

/**
 * Rewrite the persisted file to mirror the in-memory state. Used after
 * hydrate compaction and after explicit clears. Errors are logged.
 */
export async function rewriteAll(): Promise<void> {
  try {
    const path = await resolvePath();
    const lines = useMcpCheckpointStore
      .getState()
      .checkpoints.map((cp) => JSON.stringify(cp))
      .join("\n");
    await writeTextFile(path, lines.length > 0 ? lines + "\n" : "");
  } catch (error) {
    mcpBridgeError("Failed to rewrite MCP checkpoint log:", error);
  }
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
