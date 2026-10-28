/**
 * Journal refusals — the typed reason a controlled write was not prepared,
 * read from the `CommandError` the journal commands reject with.
 *
 * Key decisions:
 *   - The exact token rides in `detail.journalCode`; the command error's
 *     `code` is only its class. A rejection that is not a typed journal
 *     refusal (an IPC failure, a missing command) is `JOURNAL_UNAVAILABLE`:
 *     nothing can be assumed written, so the write does not go ahead.
 *   - `head` is carried for `STALE_PARENT` so a caller can forget the stale
 *     basis it sent.
 *   - `field` names the request field a refusal is about. `provenance`
 *     means only the window's map was refused and nothing was recorded:
 *     the caller resends the same request without it.
 *   - `STALE_REQUEST` (a request that ended, was fenced, or names a stale
 *     writer or page) and `STALE_PAGE` (a commit or abort whose page
 *     registration is no longer live) are the request protocol's answers.
 *   - `COMMENT_ANCHOR_TOO_LONG` refuses a comment anchor whose quote is
 *     over 4,096 UTF-8 bytes; `detail` carries `bytes` and `limit`.
 *   - `JOURNAL_TIMEOUT` is never sent by the journal: the client raises
 *     it when a call outlives its deadline (`journalDeadline.ts`).
 *   - `uncertain` is true only when the journal said so: the caller cannot
 *     know whether the request was admitted. A prepare's full answer is
 *     validated into `settlement` by `journalSettlement.ts`; every other
 *     command's refusal stays this lossy read.
 *   - `AMBIGUOUS_REVERT` carries the refused `hunk` and its sticky `block`
 *     (`{reason, origin}`, or `null` when coverage is unbounded);
 *     `REVERT_REFUSED` its `hunk` and why: `conflicted` (conflicted again)
 *     or `reapply` (a reverted hunk that cannot be re-applied). A reason
 *     this client does not know is read as none.
 *
 * @coordinates-with src-tauri/src/agent_journal/refusal.rs — the Rust mapping
 * @module services/agentJournal/journalRefusal
 */

import { parseCommandError } from "@/services/commands/commandError";
import type { JournalSettlement } from "./journalSettlementTypes";

/** Every token a journal command can refuse with. */
export const JOURNAL_CODES = [
  "JOURNAL_BUSY",
  "STALE_PARENT",
  "JOURNAL_DEGRADED",
  "STALE_REVIEW",
  "REVIEW_BACKLOG_FULL",
  "REVIEW_STATE_EXHAUSTED",
  "AMBIGUOUS_REVERT",
  "REVERT_REFUSED",
  "INVALID_REQUEST",
  "INVALID_TEXT",
  "COMMENT_ANCHOR_TOO_LONG",
  "STALE_COMMENT",
  "COMMENT_STATE_EXHAUSTED",
  "COMMENT_STORAGE_FULL",
  "COMMENT_LIMIT",
  "COMMENT_NOT_ALLOWED",
  "JOURNAL_IO",
  "INVARIANT_BROKEN",
  "JOURNAL_CORRUPT",
  "JOURNAL_FUTURE_FORMAT",
  "STALE_REQUEST",
  "STALE_PAGE",
  "JOURNAL_UNAVAILABLE",
  "JOURNAL_TIMEOUT",
] as const;

export type JournalCode = (typeof JOURNAL_CODES)[number];

export function isJournalCode(value: unknown): value is JournalCode {
  return typeof value === "string" && (JOURNAL_CODES as readonly string[]).includes(value);
}

/** The provenance break that blocks an automatic revert. */
export interface RevertBlock {
  reason: string;
  origin: string;
}

/** Why a revert recorded nothing (`REVERT_REFUSED`). */
export type RevertRefusedReason = "conflicted" | "reapply";
const isRevertRefusedReason = (v: unknown): v is RevertRefusedReason => v === "conflicted" || v === "reapply";

/** What a refusal carries beyond its code, message, head and field. */
export interface RefusalExtras {
  uncertain?: boolean;
  settlement?: JournalSettlement | null;
  hunk?: string | null;
  block?: RevertBlock | null;
  revertReason?: RevertRefusedReason | null;
}

/** A journal command refused; nothing was recorded for this request. */
export class JournalRefusal extends Error {
  readonly journalCode: JournalCode;
  /** The current head, for `STALE_PARENT`; `null` otherwise or at genesis. */
  readonly head: string | null;
  /** The request field refused (`provenance`), or `null` for the whole request. */
  readonly field: string | null;
  /** The journal said the request's fate is unknown. */
  readonly uncertain: boolean;
  /** A prepare's or abandon's validated answer; `null` for other commands. */
  readonly settlement: JournalSettlement | null;
  /** The refused hunk, for `AMBIGUOUS_REVERT`. */
  readonly hunk: string | null;
  /** The break blocking the revert, for `AMBIGUOUS_REVERT`. */
  readonly block: RevertBlock | null;
  /** Why the revert was refused, for `REVERT_REFUSED`. */
  readonly revertReason: RevertRefusedReason | null;

  constructor(
    journalCode: JournalCode,
    message: string,
    head: string | null = null,
    field: string | null = null,
    extras: RefusalExtras = {},
  ) {
    super(message);
    this.name = "JournalRefusal";
    this.journalCode = journalCode;
    this.head = head;
    this.field = field;
    this.uncertain = extras.uncertain ?? false;
    this.settlement = extras.settlement ?? null;
    this.hunk = extras.hunk ?? null;
    this.block = extras.block ?? null;
    this.revertReason = extras.revertReason ?? null;
  }
}

const stringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

function revertBlock(v: unknown): RevertBlock | null {
  if (!isRecord(v) || typeof v.reason !== "string" || typeof v.origin !== "string") return null;
  return { reason: v.reason, origin: v.origin };
}

/** Read any `invoke` rejection as a journal refusal. */
export function toJournalRefusal(error: unknown): JournalRefusal {
  if (error instanceof JournalRefusal) return error;
  const parsed = parseCommandError(error);
  const detail = parsed?.detail;
  const code = detail?.journalCode;
  if (parsed && isJournalCode(code)) {
    return new JournalRefusal(code, parsed.message, stringOrNull(detail?.head), stringOrNull(detail?.field), {
      uncertain: detail?.uncertain === true,
      hunk: stringOrNull(detail?.hunk),
      block: revertBlock(detail?.block),
      revertReason: isRevertRefusedReason(detail?.reason) ? detail.reason : null,
    });
  }
  const message = parsed?.message ?? (error instanceof Error ? error.message : String(error));
  return new JournalRefusal("JOURNAL_UNAVAILABLE", `the agent edit journal did not answer: ${message}`);
}
