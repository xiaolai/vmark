/**
 * History client — the IPC calls of the history panel over the agent edit
 * journal: prepare a restore (`agent_journal_restore_prepare`; its commit
 * and abort are the controlled write's), and list or discard a document's
 * uncommitted entries.
 *
 * Key decisions:
 *   - Same wire rules as `journalClient.ts`: one JSON string payload,
 *     decimal-string generations and sequence numbers, a malformed reply
 *     refused as `JOURNAL_UNAVAILABLE`. A restore prepare is one logical
 *     request sent through the same coordinator as an agent write
 *     (`journalRequest.ts`): frozen payload, page identity, bound reply,
 *     abandon; its reply is decoded losslessly.
 *   - An entry's actor is reduced to the label the panel shows (the
 *     session label, else the client's declared name); the journal keeps
 *     the full attribution.
 *
 * @coordinates-with src-tauri/src/agent_journal/commands_history.rs — the commands
 * @module services/agentJournal/historyClient
 */

import type { JournalBaseRef, PreparedTxn, PrepareSpec } from "./journalClient";
import { parseJournalActor, type JournalActor } from "./journalActor";
import type { JournalProvenancePayload } from "./unsavedProvenance";
import type { CaptureId } from "./provenance/captureId";
import { callJournalBound, isDecimal, isNullableString, isObject, isString, malformed, parsePreparedTxn } from "./journalIpc";

/** What a restore puts back: a revision, an uncommitted entry's preimage, or a pre-journal checkpoint. */
export type RestoreSource =
  | { from: "revision"; revision: string }
  | { from: "uncommittedPreimage"; txn: string }
  | { from: "legacyCheckpoint"; legacyId: string };

export interface RestorePrepareInput {
  /** `path:<file>` or `tab:<window>/<tab>` (see `documentIdentity.ts`). */
  docKey: string;
  /** The head the restore expects (`PrepareInput.parent`); `null` is genesis. */
  parent: string | null;
  /** The buffer the restore overwrites; recorded first when unjournaled. */
  preimage: string;
  source: RestoreSource;
  baselineProvenance: JournalProvenancePayload | null;
  baselineTouched: boolean;
  /** The predecessor `baselineProvenance` was built on (`PrepareInput.observedParent`). */
  observedParent?: JournalBaseRef;
  /** The provenance freeze the overwritten buffer was taken under; omitted when nothing froze it. */
  capture?: CaptureId;
}

export interface PreparedRestore extends PreparedTxn {
  /** The text to apply. */
  text: string;
  /** The uncommitted transaction the restore resolves, if any. */
  resolves: string | null;
}

export interface UncommittedEntry {
  txn: string;
  /** Who made the write, in full: the panel shows every part apart. */
  actor: JournalActor;
  tool: string;
  /** Journal order, decimal string. */
  seq: string;
  /** The start of the text the write found. */
  preview: string;
  /** Whether `preview` is the whole text. */
  complete: boolean;
}

/** Read `command`'s reply as a restore prepare, losslessly. Throws `malformed`. */
export function parseRestorePrepared(command: string, r: unknown): PreparedRestore {
  const prepared = parsePreparedTxn(command, r);
  if (!isObject(r) || typeof r.text !== "string" || !isNullableString(r.resolves)) throw malformed(command);
  return { ...prepared, text: r.text, resolves: r.resolves };
}

/** A restore's prepare request, sent by the request coordinator like an agent write's (`journalRequest.ts`). */
export function restorePrepare(input: RestorePrepareInput): PrepareSpec<PreparedRestore> {
  return { command: "agent_journal_restore_prepare", fields: input, parse: parseRestorePrepared };
}

function entryOf(command: string, row: unknown): UncommittedEntry {
  if (!isObject(row)) throw malformed(command);
  const actor = parseJournalActor(row.actor);
  if (
    !isString(row.txn) ||
    actor === undefined ||
    !isString(row.tool) ||
    !isDecimal(row.seq) ||
    typeof row.preview !== "string" ||
    typeof row.complete !== "boolean"
  ) {
    throw malformed(command);
  }
  return { txn: row.txn, actor, tool: row.tool, seq: row.seq, preview: row.preview, complete: row.complete };
}

/** A document's uncommitted entries, oldest first. Rejects with a `JournalRefusal`. */
export async function listUncommitted(docKey: string): Promise<UncommittedEntry[]> {
  const command = "agent_journal_uncommitted";
  const r = await callJournalBound(command, { payload: JSON.stringify({ docKey }) });
  if (!Array.isArray(r)) throw malformed(command);
  return r.map((row) => entryOf(command, row));
}

/** Discard one uncommitted entry. `durable: false` = queued. Rejects with a `JournalRefusal`. */
export async function discardUncommitted(docKey: string, txn: string): Promise<{ durable: boolean }> {
  const command = "agent_journal_discard";
  const r = await callJournalBound(command, { payload: JSON.stringify({ docKey, txn }) });
  if (!isObject(r) || typeof r.durable !== "boolean") throw malformed(command);
  return { durable: r.durable };
}
