/**
 * Revert replies — the two answers a revert prepare gives, read losslessly:
 * an applied revert's `prepared` reply (the exact patch the writer planned)
 * and the review decision a revert that did not apply recorded.
 *
 * Key decisions:
 *   - The patch is the writer's, never recomputed here: replace UTF-16
 *     `from..to` of the buffer with `insert`, which gives the text hashed
 *     `postimageHash`. Offsets are safe integers with `from <= to`.
 *   - A decision is a success without a transaction: it names the hunk's
 *     `reviewGen` after the decision, the decision's seq and the head it
 *     was recorded on, so the caller has nothing to commit or abort.
 *   - Each reply has exactly its fields, as the writer's structs (which
 *     deny unknown fields) serialize them; a missing or extra one, or
 *     anything else, is `malformed`, never a partial reply.
 *
 * @coordinates-with src-tauri/src/agent_journal/controlled_revert.rs — `RevertPrepared`, `RevertDecided`
 * @module services/agentJournal/revertReplies
 */

import { isDecimal, isNullableString, isObject, isString, malformed, parsePreparedTxn, type PreparedTxn } from "./journalIpc";

/** An applied revert's reply: the patch the commit must carry. */
export interface PreparedRevert extends PreparedTxn {
  hunk: string;
  /** The hunk's `reviewGen` the revert was prepared against, decimal string. */
  reviewGen: string;
  /** UTF-16 offsets into the buffer the prepare sent. */
  from: number;
  to: number;
  insert: string;
  postimageHash: string;
}

/** The decision a revert that did not apply recorded. */
type RevertDecisionAction = "conflicted" | "revertFoundBase";

export interface RevertDecided {
  doc: string;
  hunk: string;
  action: RevertDecisionAction;
  /** The hunk's `reviewGen` after the decision, decimal string. */
  reviewGen: string;
  /** The decision record's seq, decimal string. */
  generation: string;
  baseline: string | null;
  head: string | null;
}

const ACTIONS: readonly string[] = ["conflicted", "revertFoundBase"];
const PREPARED_KEYS = ["doc", "txn", "revision", "generation", "baseline", "hunk", "reviewGen", "from", "to", "insert", "postimageHash"];
const DECIDED_KEYS = ["doc", "hunk", "action", "reviewGen", "generation", "baseline", "head"];

/** Exactly `keys`, as the writer's `deny_unknown_fields` structs serialize them. */
const hasExactly = (r: object, keys: readonly string[]): boolean => {
  const own = Object.keys(r);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(r, k));
};
const isOffset = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const isBlobHash = (v: unknown): v is string => typeof v === "string" && /^sha256-[0-9a-f]{64}$/.test(v);

/** Read `command`'s reply as an applied revert, losslessly. Throws `malformed`. */
export function parseRevertPrepared(command: string, r: unknown): PreparedRevert {
  const prepared = parsePreparedTxn(command, r);
  if (
    !isObject(r) ||
    !hasExactly(r, PREPARED_KEYS) ||
    !isString(r.hunk) ||
    !isDecimal(r.reviewGen) ||
    !isOffset(r.from) ||
    !isOffset(r.to) ||
    r.from > r.to ||
    typeof r.insert !== "string" ||
    !isBlobHash(r.postimageHash)
  ) {
    throw malformed(command);
  }
  return {
    ...prepared,
    hunk: r.hunk,
    reviewGen: r.reviewGen,
    from: r.from,
    to: r.to,
    insert: r.insert,
    postimageHash: r.postimageHash,
  };
}

/** Read `command`'s reply as a revert's recorded decision, losslessly. Throws `malformed`. */
export function parseRevertDecided(command: string, r: unknown): RevertDecided {
  if (
    !isObject(r) ||
    !hasExactly(r, DECIDED_KEYS) ||
    !isString(r.doc) ||
    !isString(r.hunk) ||
    typeof r.action !== "string" ||
    !ACTIONS.includes(r.action) ||
    !isDecimal(r.reviewGen) ||
    !isDecimal(r.generation) ||
    !isNullableString(r.baseline) ||
    !isNullableString(r.head)
  ) {
    throw malformed(command);
  }
  return {
    doc: r.doc,
    hunk: r.hunk,
    action: r.action as RevertDecisionAction,
    reviewGen: r.reviewGen,
    generation: r.generation,
    baseline: r.baseline,
    head: r.head,
  };
}
