/**
 * Journal client — the IPC calls of the controlled-mutation protocol
 * (`agent_journal_prepare`, `_commit`, `_abort`) and of save capture
 * (`agent_journal_capture`), with replies validated and every rejection
 * read as a `JournalRefusal`.
 *
 * Key decisions:
 *   - Payloads cross as ONE JSON string. `JSON.stringify` escapes a lone
 *     surrogate (`\ud800`) instead of replacing it, so Rust's well-formed
 *     text check sees it and refuses `INVALID_TEXT`; a typed argument would
 *     be re-encoded on the way and could hide it.
 *   - Generations are canonical decimal strings: a JavaScript number loses
 *     precision above 2^53. A reply that is not the expected shape is
 *     refused as `JOURNAL_UNAVAILABLE`, never trusted.
 *   - A prepare and a commit answer whether a selection certificate was
 *     used; a fallback to the whole-document barrier is logged here, once
 *     for every caller, and the journal counts it in its status.
 *   - A prepare is described here (`controlledPrepare`) and sent by the
 *     request coordinator (`journalRequest.ts`), which freezes its payload
 *     and checks the reply's bind. The journal answers an identical retry
 *     from its receipt, so a prepare reply is decoded losslessly.
 *   - A commit and an abort name the page pair the request was sent for,
 *     and their reply's bind (txn and pair) is checked before its fields.
 *
 * @coordinates-with src-tauri/src/agent_journal/commands.rs — the commands
 * @module services/agentJournal/journalClient
 */

import type { JournalMcpActor } from "./journalActor";
import type { JournalProvenancePayload } from "./unsavedProvenance";
import type { SelectionCertificate } from "./selectionCertificate";
import type { CaptureId } from "./provenance/captureId";
import { callJournal as call, callJournalBound, isNullableString, isObject, isString, malformed, parseBound, parsePreparedTxn } from "./journalIpc";
import type { PagePair } from "./pageRegistration";
import { journalWarn } from "@/utils/debug";

/** Why re-verification refused to apply. */
export type AbortReason = "edited" | "closed" | "composing" | "selection" | "applyRefused";

/**
 * Why a transaction is aborted; the closed set Rust accepts. `timedOut`: its
 * prepare answered after the coordinator had given up on it, so the editor
 * never refused anything.
 */
export type JournalAbortReason = AbortReason | "timedOut";

/** What a prepare sends and how its reply is read (run by `journalRequest.ts`). */
export interface PrepareSpec<P> {
  command:
    | "agent_journal_prepare"
    | "agent_journal_restore_prepare"
    | "agent_journal_revert_prepare"
    | "comment_user_create"
    | "comment_user_reply"
    | "comment_agent_reply";
  /**
   * The request's fields, without `requestId` and the page identity. A
   * comment reply records no baseline: it has no `baselineProvenance`, so
   * a provenance refusal is never resent for it.
   */
  fields: { readonly baselineProvenance: unknown } | { readonly expectedCommentGen: string };
  /** Read the bound reply's `reply`. Throws `malformed`. */
  parse: (command: string, reply: unknown) => P;
}

/**
 * A prepare answered by a recorded decision instead of a transaction (a
 * revert that did not apply): nothing to verify, apply, commit or abort.
 */
export interface DecidedReply<D> {
  readonly kind: "decided";
  readonly decision: D;
  /** The head the decision was recorded on (a decision never moves it): the tab's basis next. */
  readonly head: string | null;
  /** A decision holds no transaction: nothing to commit or abort. */
  readonly txn?: never;
}

/** Whether a prepare's reply is a decision rather than a transaction. */
export const isDecidedReply = <D, P extends object>(reply: P | DecidedReply<D>): reply is DecidedReply<D> =>
  (reply as { kind?: unknown }).kind === "decided";

export interface PrepareInput {
  /** `path:<file>` or `tab:<window>/<tab>` (see `documentIdentity.ts`). */
  docKey: string;
  /**
   * The head the write expects: the revision this tab last learned, or the
   * head it read when it had none; `null` is genesis. Any other head is
   * refused `STALE_PARENT` (strict, every controlled prepare).
   */
  parent: string | null;
  /** The tab's buffer as the write found it. */
  preimage: string;
  actor: JournalMcpActor;
  tool: string;
  /**
   * The certified map from `observedParent`'s text to `preimage`, flushed
   * from the tab's unsaved edits (`unsavedProvenance.ts`). `null`: the
   * baseline is recorded as a `snapshotOnly` barrier.
   */
  baselineProvenance: JournalProvenancePayload | null;
  /**
   * The predecessor `baselineProvenance` was built on; the journal records
   * the baseline on it. Required with a map; without one it may be omitted,
   * and the snapshot is then recorded on the head.
   */
  observedParent?: JournalBaseRef;
  /**
   * A person changed the buffer since its journaled text, even if it is
   * equal again: an equal-text baseline is then still recorded.
   */
  baselineTouched: boolean;
  /**
   * A Source `selection.set`'s exact change (`selectionCertificate.ts`).
   * Omitted otherwise: the commit is then a whole-document barrier.
   */
  certificate?: SelectionCertificate | null;
  /** The provenance freeze this buffer was taken under; omitted when nothing froze it. */
  capture?: CaptureId;
  /** The comments the write says it addresses (`c<n>` ids); omitted when none. */
  addresses?: readonly string[];
}

import type { PreparedTxn } from "./journalIpc";
export type { PreparedTxn };

/** A controlled prepare's reply, every field the journal sent. */
export interface ControlledPrepared extends PreparedTxn {
  /** The prepare persisted the certificate it was sent. */
  certified: boolean;
  /** Why a sent certificate was not used; `null` when certified or none was sent. */
  fallbackReason: FallbackReason | null;
}

/**
 * Extra fields a commit carries beside its `postimage`, computed between the
 * apply and the commit (`journaledMutation.ts` effects). Opaque here: the
 * journal validates them (it refuses an unknown field).
 */
export type CommitExtras = Readonly<Record<string, unknown>>;

export interface CommittedTxn {
  doc: string;
  revision: string;
  applied: boolean;
  durable: boolean;
}

/** What a saved buffer was built on: a revision, or the tab's own pending save. */
export type JournalObservedRef =
  | { ref: "revision"; revision: string }
  | { ref: "pending"; observation: string };

/** What a controlled prepare's buffer was built on: a saved buffer's predecessors, or genesis. */
export type JournalBaseRef = JournalObservedRef | { ref: "genesis" };

/** Who asked for a save; not who wrote its text (`CaptureInput.author`). */
export type JournalSaveInitiator = { type: "human" } | { type: "system"; reason: string } | JournalMcpActor;

export interface CaptureInput {
  /** `path:<file>` (see `documentIdentity.ts`). */
  docKey: string;
  /** The tab's base-root name, `<window>/<tab>`. */
  window: string;
  /** `null`: the journal's head (genesis for a new document). */
  observedParent: JournalObservedRef | null;
  /** The saved editor text. */
  postimage: string;
  initiator: JournalSaveInitiator;
  /** Who wrote the saved text; `null`: the human. */
  author: JournalMcpActor | null;
  /**
   * The revision the window says holds exactly this text. The writer elides
   * the save only when that revision is still the settled head and its text
   * matches; equal text alone is recorded.
   */
  claimsRevision: string | null;
  /**
   * The window's certified map from `observedParent` (or the head) to
   * `postimage`, under its armed epoch. `null`: a `snapshotOnly` barrier.
   */
  provenance: JournalProvenancePayload | null;
  /** The provenance freeze this save was taken under; omitted for an unbound save. */
  capture?: CaptureId;
}

const JOURNALED = ["yes", "pending", "no"] as const;
/** How far a save got into the journal. */
export type Journaled = (typeof JOURNALED)[number];
const isJournaled = (v: unknown): v is Journaled => JOURNALED.some((j) => j === v);

export interface CapturedSave {
  doc: string;
  journaled: Journaled;
  /** `null` when the head already held the text. */
  observation: string | null;
  /** The revision holding the saved text; set exactly when `yes`. */
  revision: string | null;
}

/** Why the journal did not use a certificate (`FallbackReason` in Rust). */
const FALLBACK_REASONS = ["notTheParent", "notThePostimage", "wholeBreak", "splitsACharacter", "noFreeSlots", "overCap"] as const;
type FallbackReason = (typeof FALLBACK_REASONS)[number];
const isFallbackReason = (v: unknown): v is FallbackReason => FALLBACK_REASONS.some((f) => f === v);

/**
 * Check a reply's `certified` and `fallbackReason` (a certified reply has no
 * reason) and log a fallback: the write was recorded as a barrier.
 */
function checkCertification(command: string, r: Record<string, unknown>, doc: string): void {
  const reason = r.fallbackReason;
  const known = reason === null || isFallbackReason(reason);
  if (typeof r.certified !== "boolean" || !known || (r.certified && reason !== null)) throw malformed(command);
  if (reason !== null) journalWarn(`${command}: the certificate for ${doc} was not used (${String(reason)}); recorded as a barrier`);
}

/** Read `command`'s reply as a controlled prepare, losslessly. Throws `malformed`. */
export function parseControlledPrepared(command: string, r: unknown): ControlledPrepared {
  const { doc, txn, revision, generation, baseline } = parsePreparedTxn(command, r);
  if (!isObject(r)) throw malformed(command);
  checkCertification(command, r, doc);
  const fallbackReason = isFallbackReason(r.fallbackReason) ? r.fallbackReason : null;
  return { doc, txn, revision, generation, baseline, certified: r.certified === true, fallbackReason };
}

/** A controlled write's prepare request, for the request coordinator (`journalRequest.ts`). */
export function controlledPrepare(input: PrepareInput): PrepareSpec<ControlledPrepared> {
  return { command: "agent_journal_prepare", fields: input, parse: parseControlledPrepared };
}

/** The bind a commit's or abort's reply must carry: its txn and the request's frozen pair. */
const pairBind = (txn: string, { pageIdentity, webviewGeneration }: PagePair) => ({ txn, pageIdentity, webviewGeneration });

/**
 * Commit an open transaction with the applied text and any `extras` (which
 * never replace the postimage), for the page pair that prepared it. The
 * reply's bind is checked before its fields. Rejects with a `JournalRefusal`.
 */
export async function commitControlledWrite(txn: string, postimage: string, pair: PagePair, extras?: CommitExtras): Promise<CommittedTxn> {
  const command = "agent_journal_commit";
  const bind = pairBind(txn, pair);
  const args = { ...bind, payload: JSON.stringify({ ...extras, postimage }) };
  const r = parseBound(command, await call(command, args), bind);
  if (
    !isObject(r) ||
    !isString(r.doc) ||
    !isString(r.revision) ||
    typeof r.applied !== "boolean" ||
    typeof r.durable !== "boolean"
  ) {
    throw malformed("agent_journal_commit");
  }
  checkCertification("agent_journal_commit", r, r.doc);
  return { doc: r.doc, revision: r.revision, applied: r.applied, durable: r.durable };
}

/** Abort an open transaction for the pair that prepared it. `durable: false` = queued, the document stays reserved. */
export async function abortControlledWrite(txn: string, reason: JournalAbortReason, pair: PagePair): Promise<{ durable: boolean }> {
  const command = "agent_journal_abort";
  const bind = pairBind(txn, pair);
  const r = parseBound(command, await call(command, { ...bind, reason }), bind);
  if (!isObject(r) || typeof r.durable !== "boolean") throw malformed("agent_journal_abort");
  return { durable: r.durable };
}

/** Record a finished save. Rejects with a `JournalRefusal`. */
export async function captureSaveToJournal(input: CaptureInput): Promise<CapturedSave> {
  const r = await callJournalBound("agent_journal_capture", { payload: JSON.stringify(input) });
  if (
    !isObject(r) ||
    !isString(r.doc) ||
    !isJournaled(r.journaled) ||
    !isNullableString(r.observation) ||
    !isNullableString(r.revision) ||
    (r.journaled === "yes") !== (r.revision !== null) ||
    (r.journaled !== "yes" && r.observation === null)
  ) {
    throw malformed("agent_journal_capture");
  }
  return { doc: r.doc, journaled: r.journaled, observation: r.observation, revision: r.revision };
}
