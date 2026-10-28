/**
 * Revert client — the hunk revert's prepare request for the request
 * coordinator (`journalRequest.ts`): what it sends and how its reply,
 * `{kind, response}`, is read.
 *
 * Key decisions:
 *   - The request names no actor or tool: the journal records a revert as
 *     the person's own action (`human`, tool `revert`).
 *   - A `prepared` reply is the writer's patch (`revertReplies.ts`); a
 *     `decided` reply is a success with no transaction, carrying the head
 *     the decision was recorded on. Any other shape, an extra field
 *     included, is `malformed`.
 *
 * @coordinates-with src-tauri/src/agent_journal/controlled_revert.rs — `RevertPrepareRequest`, `RevertReply`
 * @coordinates-with services/agentJournal/revertReplies.ts — the two responses
 * @module services/agentJournal/revertClient
 */

import type { CaptureId } from "./provenance/captureId";
import type { DecidedReply, JournalBaseRef, PrepareSpec } from "./journalClient";
import { isObject, malformed } from "./journalIpc";
import { parseRevertDecided, parseRevertPrepared, type PreparedRevert, type RevertDecided } from "./revertReplies";
import type { JournalProvenancePayload } from "./unsavedProvenance";

export interface RevertPrepareInput {
  docKey: string;
  /** The head the tab expects; `null` is genesis (strict). */
  parent: string | null;
  /** The tab's buffer: the text the revert edits. */
  preimage: string;
  hunkId: string;
  /** The hunk's `reviewGen` the panel rendered, decimal string. */
  expectedReviewGen: string;
  baselineProvenance: JournalProvenancePayload | null;
  observedParent?: JournalBaseRef;
  baselineTouched: boolean;
  capture?: CaptureId;
}

/** An applied revert's patch, tagged. */
export type PreparedRevertReply = PreparedRevert & { readonly kind: "prepared" };

/** What a revert prepare answers: the patch to apply, or the decision recorded instead. */
export type RevertReply = PreparedRevertReply | DecidedReply<RevertDecided>;

/** Read `command`'s reply `{kind, response}` whole. Throws `malformed`. */
export function parseRevertReply(command: string, r: unknown): RevertReply {
  if (!isObject(r) || Object.keys(r).length !== 2 || !("response" in r)) throw malformed(command);
  if (r.kind === "prepared") return { kind: "prepared", ...parseRevertPrepared(command, r.response) };
  if (r.kind !== "decided") throw malformed(command);
  const decision = parseRevertDecided(command, r.response);
  return { kind: "decided", decision, head: decision.head };
}

/** A hunk revert's prepare request, for the request coordinator. */
export function revertPrepare(input: RevertPrepareInput): PrepareSpec<RevertReply> {
  return { command: "agent_journal_revert_prepare", fields: input, parse: parseRevertReply };
}
