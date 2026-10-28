/**
 * Comment replies — the exact decoders of every comment command's reply:
 * a create, a reply, a state change, a deletion and the comment list.
 *
 * Key decisions:
 *   - Every object is read whole: a missing field, an extra field, a
 *     non-canonical id (`c<u64>`, `r<u64>`) or counter, or an unknown
 *     state, caller or tier is `malformed`, never read. A reply that is
 *     not the shape asked for is a broken journal, not a refusal.
 *   - Counters (`generation`, `commentGen`) stay decimal strings: they run
 *     past 2^53, so they are never read as numbers.
 *   - Bodies, authors and quotes are kept exactly as sent: they are text
 *     that the panel renders as text, never markup.
 *   - Anchor offsets are UTF-16 code units in the window's text.
 *
 * @coordinates-with src-tauri/src/agent_journal/comment/replies.rs — the four action replies
 * @coordinates-with src-tauri/src/agent_journal/comment/list.rs — the list
 * @coordinates-with src-tauri/src/agent_journal/comment_anchor.rs — `Resolution`
 * @module services/agentJournal/comments/commentReplies
 */

import { isDecimal, isObject, isString, malformed } from "../journalIpc";

export type ThreadState = "open" | "addressed" | "resolved" | "reopened";
type CommentCaller = "user" | "agent";
type AnchorTier = "context" | "headingPath" | "anywhere";

type CommentAnchor =
  | { status: "resolved"; tier: AnchorTier; start: number; end: number; byHint: boolean }
  | { status: "ambiguous"; tier: AnchorTier; candidates: number[] }
  | { status: "orphaned" };

export interface CommentCreated {
  doc: string;
  comment: string;
  /** The revision the thread was created on (a recorded baseline, or the head). */
  revision: string;
  textHash: string;
  generation: string;
  commentGen: string;
}

export interface CommentReplied {
  doc: string;
  comment: string;
  reply: string;
  generation: string;
  commentGen: string;
}

export interface CommentStateChanged {
  doc: string;
  comment: string;
  state: ThreadState;
  generation: string;
  commentGen: string;
}

export interface CommentDeleted {
  doc: string;
  comment: string;
  generation: string;
}

interface CommentReplyView {
  reply: string;
  body: string;
  author: string;
  caller: CommentCaller;
}

export interface CommentThread {
  comment: string;
  state: ThreadState;
  commentGen: string;
  revision: string;
  /** False once the creation revision's text was collected. */
  creationRetained: boolean;
  quote: string;
  body: string;
  author: string;
  caller: CommentCaller;
  replies: CommentReplyView[];
  anchor: CommentAnchor;
}

export interface CommentList {
  /** `null` for a key the journal has never seen. */
  doc: string | null;
  generation: string;
  threads: CommentThread[];
}

const STATES: readonly string[] = ["open", "addressed", "resolved", "reopened"];
const CALLERS: readonly string[] = ["user", "agent"];
const TIERS: readonly string[] = ["context", "headingPath", "anywhere"];
const TEXT_HASH = /^sha256-[0-9a-f]{64}$/;

const isText = (v: unknown): v is string => typeof v === "string";
const isOffset = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isState = (v: unknown): v is ThreadState => typeof v === "string" && STATES.includes(v);
const isCaller = (v: unknown): v is CommentCaller => typeof v === "string" && CALLERS.includes(v);
const isTier = (v: unknown): v is AnchorTier => typeof v === "string" && TIERS.includes(v);
/** `<prefix><canonical u64>`, as Rust's `seq_id!` writes it. */
const seqId = (prefix: string) => (v: unknown): v is string =>
  typeof v === "string" && v.startsWith(prefix) && isDecimal(v.slice(prefix.length));
/** A comment id as the journal writes it: `c<canonical u64>`. */
export const isCommentId = seqId("c");
const isReplyId = seqId("r");

/** `r` as an object with exactly `keys`; throws `malformed` otherwise. */
function exact(command: string, r: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isObject(r) || Array.isArray(r)) throw malformed(command);
  const got = Object.keys(r);
  if (got.length !== keys.length || !keys.every((k) => Object.hasOwn(r, k))) throw malformed(command);
  return r;
}

function check<T>(command: string, ok: boolean, value: T): T {
  if (!ok) throw malformed(command);
  return value;
}

/** A create's reply. */
export function parseCommentCreated(command: string, r: unknown): CommentCreated {
  const o = exact(command, r, ["doc", "comment", "revision", "textHash", "generation", "commentGen"]);
  const ok = isString(o.doc) && isCommentId(o.comment) && isString(o.revision) && typeof o.textHash === "string" &&
    TEXT_HASH.test(o.textHash) && isDecimal(o.generation) && isDecimal(o.commentGen);
  return check(command, ok, o as unknown as CommentCreated);
}

/** A reply's reply. */
export function parseCommentReplied(command: string, r: unknown): CommentReplied {
  const o = exact(command, r, ["doc", "comment", "reply", "generation", "commentGen"]);
  const ok = isString(o.doc) && isCommentId(o.comment) && isReplyId(o.reply) && isDecimal(o.generation) && isDecimal(o.commentGen);
  return check(command, ok, o as unknown as CommentReplied);
}

/** A state change's reply (`markAddressed`, resolve, reopen). */
export function parseCommentState(command: string, r: unknown): CommentStateChanged {
  const o = exact(command, r, ["doc", "comment", "state", "generation", "commentGen"]);
  const ok = isString(o.doc) && isCommentId(o.comment) && isState(o.state) && isDecimal(o.generation) && isDecimal(o.commentGen);
  return check(command, ok, o as unknown as CommentStateChanged);
}

/** A deletion's reply. */
export function parseCommentDeleted(command: string, r: unknown): CommentDeleted {
  const o = exact(command, r, ["doc", "comment", "generation"]);
  const ok = isString(o.doc) && isCommentId(o.comment) && isDecimal(o.generation);
  return check(command, ok, o as unknown as CommentDeleted);
}

function parseAnchor(command: string, r: unknown): CommentAnchor {
  if (!isObject(r)) throw malformed(command);
  if (r.status === "orphaned") {
    exact(command, r, ["status"]);
    return { status: "orphaned" };
  }
  if (r.status === "ambiguous") {
    const o = exact(command, r, ["status", "tier", "candidates"]);
    const { candidates } = o;
    const ok = isTier(o.tier) && Array.isArray(candidates) && candidates.length > 0 && candidates.every(isOffset);
    return check(command, ok, { status: "ambiguous", tier: o.tier as AnchorTier, candidates: [...(candidates as number[])] });
  }
  const o = exact(command, r, ["status", "tier", "start", "end", "byHint"]);
  const ok = o.status === "resolved" && isTier(o.tier) && isOffset(o.start) && isOffset(o.end) && o.start <= o.end &&
    typeof o.byHint === "boolean";
  return check(command, ok, { status: "resolved", tier: o.tier as AnchorTier, start: o.start as number, end: o.end as number, byHint: o.byHint as boolean });
}

function parseReply(command: string, r: unknown): CommentReplyView {
  const o = exact(command, r, ["reply", "body", "author", "caller"]);
  const ok = isReplyId(o.reply) && isText(o.body) && isText(o.author) && isCaller(o.caller);
  return check(command, ok, { reply: o.reply as string, body: o.body as string, author: o.author as string, caller: o.caller as CommentCaller });
}

const THREAD_KEYS = ["comment", "state", "commentGen", "revision", "creationRetained", "quote", "body", "author", "caller", "replies", "anchor"];

function parseThread(command: string, r: unknown): CommentThread {
  const o = exact(command, r, THREAD_KEYS);
  const ok = isCommentId(o.comment) && isState(o.state) && isDecimal(o.commentGen) && isString(o.revision) &&
    typeof o.creationRetained === "boolean" && isText(o.quote) && isText(o.body) && isText(o.author) &&
    isCaller(o.caller) && Array.isArray(o.replies);
  if (!ok) throw malformed(command);
  return {
    comment: o.comment as string,
    state: o.state as ThreadState,
    commentGen: o.commentGen as string,
    revision: o.revision as string,
    creationRetained: o.creationRetained as boolean,
    quote: o.quote as string,
    body: o.body as string,
    author: o.author as string,
    caller: o.caller as CommentCaller,
    replies: (o.replies as unknown[]).map((x) => parseReply(command, x)),
    anchor: parseAnchor(command, o.anchor),
  };
}

/** The comment list. */
export function parseCommentList(command: string, r: unknown): CommentList {
  const o = exact(command, r, ["doc", "generation", "threads"]);
  if (!(o.doc === null || isString(o.doc)) || !isDecimal(o.generation) || !Array.isArray(o.threads)) throw malformed(command);
  return { doc: o.doc, generation: o.generation, threads: o.threads.map((t) => parseThread(command, t)) };
}
