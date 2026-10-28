/**
 * Checkpoint client — the history panel's "Earlier checkpoints": the
 * checkpoints earlier versions kept, imported into the agent edit journal
 * (`agent_journal_checkpoints*`) from the retired `mcp-checkpoints.jsonl`.
 *
 * Key decisions:
 *   - Read and forget only. Agent writes are journaled revisions now, so
 *     nothing records new checkpoints.
 *   - The journal opens on a background thread, and the panel hydrates at
 *     startup: every call first waits for `agent_journal_status` to leave
 *     `starting`, polling every `START_POLL_MS`, at most
 *     `JOURNAL_START_WAIT_MS` by the monotonic clock; no sleep outlasts
 *     what is left of that wait. Each status call runs
 *     under the journal deadline, capped by what is left of that wait, so a
 *     hung call cannot hold it open. A journal that failed or never
 *     finished is refused (`JOURNAL_UNAVAILABLE`), and the next call asks
 *     again.
 *   - Same wire rules as the other journal clients (`journalIpc.ts`): one
 *     JSON string payload, every reply checked before it is trusted.
 *
 * @coordinates-with src-tauri/src/agent_journal/commands_history.rs — the commands
 * @coordinates-with components/McpHistory/EarlierCheckpoints.tsx — the panel
 * @coordinates-with services/agentJournal/earlierCheckpointRestore.ts — the restore
 * @module services/agentJournal/checkpointClient
 */

import { callJournalBound, isEpochMillis, isNullableString, isObject, isString, malformed } from "./journalIpc";
import { JOURNAL_DEADLINE_MS, startJournalBudget, withJournalDeadline } from "./journalDeadline";
import { JournalRefusal } from "./journalRefusal";

/** Longest wait for the journal to finish starting. */
export const JOURNAL_START_WAIT_MS = 60_000;
const START_POLL_MS = 100;

/**
 * Where a checkpoint belongs: exactly one of an untitled tab's id or a saved
 * file's path (the journal's `LegacyAnchor`, one variant or the other).
 */
type CheckpointAnchor = { tabId: string; filePath: null } | { tabId: null; filePath: string };

/** One checkpoint as the journal keeps it (see `controller_checkpoints.rs`). */
export type JournalCheckpoint = CheckpointAnchor & {
  id: string;
  /** Milliseconds since the epoch. */
  timestamp: number;
  tool: string;
  description: string;
  contentBefore: string;
};

/** What one forget did (the journal's `ForgetReport`). */
export interface ForgetReport {
  /** Checkpoints removed from the journal. */
  forgotten: number;
  /**
   * Set when the records went but the pack compaction failed: the removed
   * text stays on disk until the next compaction, so the clear is partial.
   */
  blobError: string | null;
}

let ready: Promise<void> | null = null;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const stillStarting = () => new JournalRefusal("JOURNAL_UNAVAILABLE", "the agent edit journal is still starting");

async function waitForStart(): Promise<void> {
  const budget = startJournalBudget(JOURNAL_START_WAIT_MS);
  for (;;) {
    const left = Math.min(JOURNAL_DEADLINE_MS, budget.remaining());
    if (left <= 0) throw stillStarting();
    const s = await withJournalDeadline("its status", () => callJournalBound("agent_journal_status", {}), left).catch(
      (error: unknown) => {
        if (error instanceof JournalRefusal && error.journalCode === "JOURNAL_TIMEOUT") throw stillStarting();
        throw error;
      },
    );
    const phase = isObject(s) ? s.phase : undefined;
    if (phase === "ready") return;
    if (phase !== "starting") {
      throw new JournalRefusal("JOURNAL_UNAVAILABLE", `the agent edit journal did not start (${String(phase)})`);
    }
    if (budget.remaining() <= 0) throw stillStarting();
    await sleep(Math.min(START_POLL_MS, budget.remaining()));
  }
}

/** Resolve once the journal is ready; a refused wait is retried by the next call. */
function journalReady(): Promise<void> {
  ready ??= waitForStart().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

const isAnchor = (tabId: unknown, filePath: unknown): boolean =>
  (isString(tabId) && filePath === null) || (tabId === null && isString(filePath));

function isCheckpoint(v: unknown): v is JournalCheckpoint {
  return (
    isObject(v) &&
    isString(v.id) &&
    isAnchor(v.tabId, v.filePath) &&
    isEpochMillis(v.timestamp) &&
    isString(v.tool) &&
    typeof v.description === "string" &&
    typeof v.contentBefore === "string"
  );
}

/** Every checkpoint, in the order they were written. Rejects with a `JournalRefusal`. */
export async function listJournalCheckpoints(): Promise<JournalCheckpoint[]> {
  await journalReady();
  const command = "agent_journal_checkpoints";
  const r = await callJournalBound(command, {});
  if (!Array.isArray(r) || !r.every(isCheckpoint)) throw malformed(command);
  return r;
}

/**
 * Delete checkpoints by id; answers how many the journal held and whether
 * their bytes were compacted away (`blobError` set: not yet). A call naming
 * no ids (or only forgotten ones) still reaches the journal, which retries
 * the compaction a failed one left owing.
 */
export async function forgetJournalCheckpoints(ids: readonly string[]): Promise<ForgetReport> {
  await journalReady();
  const command = "agent_journal_checkpoints_forget";
  const r = await callJournalBound(command, { payload: JSON.stringify({ ids }) });
  const named = new Set(ids).size;
  if (!isObject(r) || !isCount(r.forgotten, named) || !isNullableString(r.blobError)) throw malformed(command);
  return { forgotten: r.forgotten, blobError: r.blobError };
}

/** The journal forgets each distinct id at most once. */
const isCount = (v: unknown, max: number): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;

/** Tests only: forget the cached readiness. */
export function resetJournalCheckpointClient(): void {
  ready = null;
}
