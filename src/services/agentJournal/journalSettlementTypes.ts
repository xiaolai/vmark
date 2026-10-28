/**
 * Journal settlement types — the shapes a validated request answer can take,
 * shared by the refusal that carries one and the parser that produces it.
 *
 * Key decisions:
 *   - Types only, with no imports: `journalRefusal.ts` carries a settlement
 *     and `journalSettlement.ts` reads refusal codes, so the shapes live
 *     below both to keep the two modules acyclic.
 *
 * @coordinates-with src/services/agentJournal/journalSettlement.ts — the parser that produces these
 * @module services/agentJournal/journalSettlementTypes
 */

/** A queued terminal record's kind. */
export type Ending = "committed" | "aborted" | "uncommitted";
/** A durable terminal status. */
export type Ended = Ending | "discarded" | "resolved";

/** Why an answer leaves the request's fate unknown. */
export type UncertainCause =
  | "inFlight"
  | "unavailable"
  | "staleIncarnation"
  | "staleGeneration"
  | "conflict"
  | "malformed"
  | "timeout"
  | "transport";

/** A validated request answer. */
export type JournalSettlement =
  | { kind: "notAdmitted" }
  | { kind: "terminalPending"; terminal: Ending }
  | { kind: "terminal"; status: Ended; by: string | null }
  | { kind: "abandoned" }
  | { kind: "uncertain"; cause: UncertainCause };
