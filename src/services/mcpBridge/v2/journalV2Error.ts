/**
 * Journal V2 errors — the bridge answer for a write the agent edit journal
 * refused or aborted, worded for the agent that must decide what to do next.
 *
 * Key decisions:
 *   - Refusals the agent can act on keep their journal token
 *     (JOURNAL_BUSY, STALE_PARENT, JOURNAL_DEGRADED, INVALID_TEXT,
 *     REVIEW_BACKLOG_FULL); a refused `addresses` set is INVALID_ADDRESSES,
 *     told apart from other INVALID_REQUESTs by the field it names. A
 *     journal that cannot record anything —
 *     not running, an I/O failure, a damaged or newer-format file, or no
 *     answer in time (nothing was applied either way) — is
 *     JOURNAL_UNAVAILABLE. Anything else is a defect: INTERNAL.
 *   - An abort is ABORTED with the reason, so the agent can tell typing
 *     from a closed tab without parsing prose.
 *   - An apply that failed part-way is INTERNAL with `applied: true` (and
 *     `durable`): the document DID change, so the agent must re-read rather
 *     than retry blind. One that could not be read back is INTERNAL with no
 *     `applied`: whether it changed is unknown.
 *
 * @coordinates-with services/agentJournal/journalRefusal.ts — the tokens
 * @coordinates-with documentWrite.ts — the caller
 * @module services/mcpBridge/v2/journalV2Error
 */

import type { AbortReason } from "@/services/agentJournal/journalClient";
import type { JournalRefusal } from "@/services/agentJournal/journalRefusal";
import type { V2Error } from "./types";

const INVALID_TEXT: V2Error = {
  error: "INVALID_TEXT",
  message: "content contains a lone UTF-16 surrogate; send well-formed text",
};

const REFUSED: Partial<Record<JournalRefusal["journalCode"], V2Error>> = {
  JOURNAL_BUSY: {
    error: "JOURNAL_BUSY",
    message: "Another write to this document is in progress; retry shortly",
  },
  STALE_PARENT: {
    error: "STALE_PARENT",
    message: "The document was changed in another window since this tab last wrote it; re-read it and retry",
  },
  JOURNAL_DEGRADED: {
    error: "JOURNAL_DEGRADED",
    message: "VMark is still recording an earlier change to this document; retry in a few seconds",
  },
  INVALID_TEXT,
  REVIEW_BACKLOG_FULL: {
    error: "REVIEW_BACKLOG_FULL",
    message: "This document has too many unreviewed AI changes; ask the user to review them first",
  },
};

/** The answer for content the journal would refuse: checked before any prepare. */
export function invalidTextError(): V2Error {
  return INVALID_TEXT;
}

/** The answer for a write whose `addresses` the journal (or the window) refused: nothing changed. */
export function invalidAddressesError(why: string): V2Error {
  return { error: "INVALID_ADDRESSES", message: `${why}; list the comments again and send only unresolved ones of this document` };
}

const UNAVAILABLE = new Set<JournalRefusal["journalCode"]>([
  "JOURNAL_UNAVAILABLE",
  "JOURNAL_IO",
  "JOURNAL_CORRUPT",
  "JOURNAL_FUTURE_FORMAT",
  "JOURNAL_TIMEOUT",
]);

/** The answer for a write the journal refused before anything changed. */
export function journalRefusalError(refusal: JournalRefusal): V2Error {
  if (refusal.journalCode === "INVALID_REQUEST" && refusal.field === "addresses") return invalidAddressesError(refusal.message);
  const known = REFUSED[refusal.journalCode];
  if (known) return known;
  if (UNAVAILABLE.has(refusal.journalCode)) {
    return {
      error: "JOURNAL_UNAVAILABLE",
      message: `VMark's agent edit journal cannot record this write, so it was not made: ${refusal.message}`,
    };
  }
  return { error: "INTERNAL", message: `The agent edit journal refused the write (${refusal.journalCode})` };
}

const ABORT_MESSAGES: Record<AbortReason, string> = {
  edited: "The user edited the document while the write was being recorded; re-read it and retry",
  closed: "The tab was closed while the write was being recorded",
  composing: "The user started composing text with an input method in this document; retry shortly",
  selection: "The user moved the selection or switched tabs while the write was being recorded; retry",
  applyRefused: "The editor did not accept the content; nothing was written",
};

/** The answer for a write aborted after the journal's prepare. */
export function abortedError(reason: AbortReason): V2Error {
  return { error: "ABORTED", reason, message: ABORT_MESSAGES[reason] };
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The answer for an apply that threw after changing the document; what it holds was recorded. */
export function appliedWithErrorError(error: unknown, durable: boolean, revision: string): V2Error {
  return {
    error: "INTERNAL",
    applied: true,
    durable,
    current_revision: revision,
    message: `The edit was applied, but the editor failed while finishing it (${messageOf(error)}); re-read the document before writing again`,
  };
}

/** The answer for an apply that threw and left a document that could not be read back. */
export function recoveryRequiredError(error: unknown): V2Error {
  return {
    error: "INTERNAL",
    message: `The edit failed part-way (${messageOf(error)}) and VMark could not read the document back; it may be partly changed. Re-read it before writing again`,
  };
}
