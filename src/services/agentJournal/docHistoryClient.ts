/**
 * Document history client — the history panel's revision list over the
 * agent edit journal (`agent_journal_history`): a document's revisions with
 * who made each one, every live hunk as the writer persisted it, the live
 * hunks whose automatic revert is blocked, and whether a record of it is
 * still queued.
 *
 * Key decisions:
 *   - Every reply is checked before it is trusted (`journalIpc.ts`): an
 *     unknown revision kind, break reason, hunk state or principal state is
 *     a malformed reply, refused as `JOURNAL_UNAVAILABLE`, never shown as
 *     some other state.
 *   - Live hunks pass through one per persisted hunk, in the journal's
 *     order, with its own geometry: the panel never regroups or re-diffs
 *     them.
 *   - A hunk carries what a review decision is checked against (its
 *     `reviewGen`, mapped span and edited-since flag) and the reply names
 *     the head; a live span may be inverted, a hunk's own ranges may not,
 *     and a blocked hunk has no span: the panel must not place it.
 *   - A blocked hunk's `lastCertified` stays `null` when the journal has
 *     none; the panel must not invent a location for it.
 *   - A row's `addresses` are the comments its write said it addressed;
 *     `deleted` is the journal's answer (no longer held, or deleted), read
 *     under the same lock as the rows: the panel never looks the id up.
 *
 * @coordinates-with src-tauri/src/agent_journal/controller_doc_history.rs — the reply
 * @module services/agentJournal/docHistoryClient
 */

import { callJournalBound, isDecimal, isEpochMillis, isNullableString, isObject, isString, malformed } from "./journalIpc";
import { parseJournalActor, type JournalActor } from "./journalActor";
import { BREAK_REASONS, type BreakReason } from "./provenance/accumulator";
import { HUNK_STATES, type HunkState } from "./review/reviewTransitions";

export const REVISION_KINDS = ["controlled", "observed", "concurrent", "gap", "tombstone"] as const;
export type RevisionKind = (typeof REVISION_KINDS)[number];

const HUNK_KINDS = ["change", "largeChange", "tooComplex", "restore"] as const;
export type HunkKind = (typeof HUNK_KINDS)[number];

/** A UTF-16 span `[from, to)`. */
interface HunkRange {
  from: number;
  to: number;
}

/** One live hunk, exactly as the journal persisted it. */
export interface LiveHunk {
  hunkId: string;
  kind: HunkKind;
  state: HunkState;
  /** The revision that made it. */
  target: string;
  /** Its span in the target's parent. */
  baseRange: HunkRange;
  /** Its span in the target. */
  targetRange: HunkRange;
  /** The generation a review decision on it names, decimal string. */
  reviewGen: string;
  /** Where it is in the head; may be inverted (`from > to`) after its text was deleted and re-typed; `null` once blocked. */
  span: HunkRange | null;
  /** An edit touched the span since the hunk was made. */
  editedSince: boolean;
}

export interface HistoryRow {
  revision: string;
  /** Journal order, decimal string. */
  seq: string;
  /** Milliseconds since the epoch. */
  at: number;
  kind: RevisionKind;
  /** The linear parent; `null` is the empty document the journal starts from. */
  parent: string | null;
  actor: JournalActor;
  /** Who asked for it to be recorded, when the journal keeps that. */
  initiator: JournalActor | null;
  tool: string | null;
  restore: boolean;
  /** Its text was collected by retention; it cannot be restored. */
  collected: boolean;
  /** The comments its write said it addressed, in the order sent. */
  addresses: AddressedComment[];
}

/** A comment a write said it addressed; `deleted` once the journal no longer holds it. */
interface AddressedComment {
  comment: string;
  deleted: boolean;
}

export interface BlockedHunk {
  hunkId: string;
  state: HunkState;
  reason: BreakReason;
  origin: string;
  lastCertified: string | null;
  blockedAt: string | null;
  target: string;
}

export interface DocumentHistory {
  generation: string;
  /** The head a review decision names; `null` for genesis or a document the journal never saw. */
  head: string | null;
  rows: HistoryRow[];
  truncated: boolean;
  /** Newest revision first, document order within a revision. */
  hunks: LiveHunk[];
  blocked: BlockedHunk[];
  /** A record of this document is queued, not yet on disk. */
  degraded: boolean;
}

const COMMAND = "agent_journal_history";

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

function addressOf(a: unknown): AddressedComment {
  if (!isObject(a) || !isString(a.comment) || typeof a.deleted !== "boolean") throw malformed(COMMAND);
  return { comment: a.comment, deleted: a.deleted };
}

function rowOf(r: unknown): HistoryRow {
  if (!isObject(r)) throw malformed(COMMAND);
  const actor = parseJournalActor(r.actor);
  const initiator = r.initiator === null ? null : parseJournalActor(r.initiator);
  if (
    !isString(r.revision) ||
    !isDecimal(r.seq) ||
    !isEpochMillis(r.at) ||
    !oneOf(REVISION_KINDS, r.kind) ||
    !isNullableString(r.parent) ||
    actor === undefined ||
    initiator === undefined ||
    !isNullableString(r.tool) ||
    typeof r.restore !== "boolean" ||
    typeof r.collected !== "boolean" ||
    !Array.isArray(r.addresses)
  ) {
    throw malformed(COMMAND);
  }
  return {
    revision: r.revision,
    seq: r.seq,
    at: r.at,
    kind: r.kind,
    parent: r.parent,
    actor,
    initiator,
    tool: r.tool,
    restore: r.restore,
    collected: r.collected,
    addresses: r.addresses.map(addressOf),
  };
}

const isOffset = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function offsetsOf(v: unknown): HunkRange {
  if (!isObject(v) || !isOffset(v.from) || !isOffset(v.to)) throw malformed(COMMAND);
  return { from: v.from, to: v.to };
}

function rangeOf(v: unknown): HunkRange {
  const r = offsetsOf(v);
  if (r.from > r.to) throw malformed(COMMAND);
  return r;
}

function hunkOf(h: unknown): LiveHunk {
  if (!isObject(h) || !isString(h.hunkId) || !oneOf(HUNK_KINDS, h.kind) || !oneOf(HUNK_STATES, h.state) || !isString(h.target) || !isDecimal(h.reviewGen) || typeof h.editedSince !== "boolean") {
    throw malformed(COMMAND);
  }
  return {
    hunkId: h.hunkId,
    kind: h.kind,
    state: h.state,
    target: h.target,
    baseRange: rangeOf(h.baseRange),
    targetRange: rangeOf(h.targetRange),
    reviewGen: h.reviewGen,
    span: h.span === null ? null : offsetsOf(h.span),
    editedSince: h.editedSince,
  };
}

function blockedOf(b: unknown): BlockedHunk {
  if (
    !isObject(b) ||
    !isString(b.hunkId) ||
    !oneOf(HUNK_STATES, b.state) ||
    !oneOf(BREAK_REASONS, b.reason) ||
    !isString(b.origin) ||
    !isNullableString(b.lastCertified) ||
    !isNullableString(b.blockedAt) ||
    !isString(b.target)
  ) {
    throw malformed(COMMAND);
  }
  return {
    hunkId: b.hunkId,
    state: b.state,
    reason: b.reason,
    origin: b.origin,
    lastCertified: b.lastCertified,
    blockedAt: b.blockedAt,
    target: b.target,
  };
}

/** Document `docKey`'s history. Rejects with a `JournalRefusal`. */
export async function listDocumentHistory(docKey: string): Promise<DocumentHistory> {
  const r = await callJournalBound(COMMAND, { payload: JSON.stringify({ docKey }) });
  if (
    !isObject(r) ||
    !isDecimal(r.generation) ||
    !isNullableString(r.head) ||
    !Array.isArray(r.rows) ||
    typeof r.truncated !== "boolean" ||
    !Array.isArray(r.hunks) ||
    !Array.isArray(r.blocked) ||
    typeof r.degraded !== "boolean"
  ) {
    throw malformed(COMMAND);
  }
  return {
    generation: r.generation,
    head: r.head,
    rows: r.rows.map(rowOf),
    truncated: r.truncated,
    hunks: r.hunks.map(hunkOf),
    blocked: r.blocked.map(blockedOf),
    degraded: r.degraded,
  };
}
