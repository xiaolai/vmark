/**
 * Journal settlement — validate a prepare's or abandon's refusal into what
 * the request coordinator may act on: proof that the request was never
 * admitted, proof of how it ended, or uncertainty.
 *
 * Key decisions:
 *   - Field by field and fail-closed: a missing or mistyped `uncertain`, a
 *     request that names another id or digest, an unknown state, a terminal
 *     without a valid status (never `prepared`), `discarded` or `resolved`
 *     without `by`, a code that does not match its state, or no echo at all
 *     is `uncertain`. No arm defaults to clean.
 *   - Only `notAdmitted` with `uncertain === false` lets the caller release
 *     what it froze; the terminal arms prove the request ended without this
 *     attempt; every other answer leaves the request's fate unknown.
 *
 * @coordinates-with src-tauri/src/agent_journal/admission/answer.rs — the states and their codes
 * @module services/agentJournal/journalSettlement
 */

import { parseCommandError } from "@/services/commands/commandError";
import { isJournalCode } from "./journalRefusal";
import type { Ended, Ending, JournalSettlement, UncertainCause } from "./journalSettlementTypes";

/** The request a reply must name: its id and the client's digest of `P`. */
export interface RequestExpectation {
  requestId: string;
  digest: string;
}

const ENDINGS: readonly string[] = ["committed", "aborted", "uncommitted"];
const NEEDS_BY: readonly string[] = ["discarded", "resolved"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isEnding = (v: unknown): v is Ending => typeof v === "string" && ENDINGS.includes(v);
const isEnded = (v: unknown): v is Ended => isEnding(v) || (typeof v === "string" && NEEDS_BY.includes(v));

/** The uncertain states, each with the one code it answers with. */
type UncertainState = Exclude<UncertainCause, "malformed" | "timeout" | "transport">;
const UNCERTAIN_STATES: Readonly<Record<UncertainState, string>> = {
  inFlight: "JOURNAL_BUSY",
  staleIncarnation: "STALE_REQUEST",
  staleGeneration: "STALE_REQUEST",
  conflict: "INVALID_REQUEST",
  unavailable: "JOURNAL_DEGRADED",
};

const isUncertainState = (s: string): s is UncertainState => Object.hasOwn(UNCERTAIN_STATES, s);

const uncertain = (cause: UncertainCause): JournalSettlement => ({ kind: "uncertain", cause });
const MALFORMED = uncertain("malformed");

/** The certain arms: each requires `uncertain === false` and `STALE_REQUEST`. */
function settleEnded(state: unknown, request: Record<string, unknown>): JournalSettlement {
  if (state === "abandoned") return { kind: "abandoned" };
  if (state === "terminalPending") {
    return isEnding(request.terminal) ? { kind: "terminalPending", terminal: request.terminal } : MALFORMED;
  }
  if (state === "terminal" && isEnded(request.status)) {
    const by = request.by;
    if (NEEDS_BY.includes(request.status)) {
      return typeof by === "string" && by.length > 0 ? { kind: "terminal", status: request.status, by } : MALFORMED;
    }
    return { kind: "terminal", status: request.status, by: null };
  }
  return MALFORMED;
}

/** Validate a prepare's or abandon's rejection against the request it was for. */
export function settleRequestRefusal(error: unknown, expect: RequestExpectation): JournalSettlement {
  const detail = parseCommandError(error)?.detail;
  if (!detail || !isJournalCode(detail.journalCode) || typeof detail.uncertain !== "boolean") return MALFORMED;
  const { journalCode: code, uncertain: unsure, request } = detail;
  if (!isRecord(request)) return unsure ? uncertain("unavailable") : MALFORMED;
  if (request.id !== expect.requestId || request.digest !== expect.digest) return MALFORMED;
  const state = request.state;
  if (typeof state !== "string") return MALFORMED;
  if (isUncertainState(state)) {
    return unsure && code === UNCERTAIN_STATES[state] ? uncertain(state) : MALFORMED;
  }
  if (unsure) return MALFORMED;
  if (state === "notAdmitted") return { kind: "notAdmitted" };
  return code === "STALE_REQUEST" ? settleEnded(state, request) : MALFORMED;
}
