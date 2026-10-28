/**
 * Pages of `comments.list` — a document's threads cut into responses that fit
 * the output bound, with a cursor to the rest.
 *
 * A document may hold 1,000 threads of up to 256 KiB each (the journal's
 * comment bounds), far past the ~75,000-byte output bound; a list cut by the
 * generic bound left its tail unreachable, since the action had no way to ask
 * for it.
 *
 * Key decisions:
 *   - Paged here, over the app's whole list: the bridge carries the list
 *     whole (its frame limit is MiBs) and the bound is the sidecar's own.
 *   - A cursor names where the next page starts — a thread id and a reply
 *     index — not an offset or a generation. Threads only append and replies
 *     are never removed, so a cursor stays good across any other edit; only
 *     deleting the thread it names breaks it, and that is refused with a
 *     clear "list again".
 *   - A cursor also carries a digest of the document it was issued for, and
 *     is refused STALE_COMMENT on any other: thread ids are only unique
 *     within a document, so another document's same id would resume the
 *     wrong list.
 *   - A thread too long for one page is split between replies: its first
 *     part carries the thread with `repliesTotal`, each later part only
 *     `{comment, state, commentGen, continued: true, repliesFrom,
 *     repliesTotal, replies}`.
 *   - Entries are costed as they serialize inside the page (pretty-printed,
 *     indented), with a margin; the finished page is measured and a page over
 *     the bound throws, never ships truncated.
 *   - One entry larger than a whole page — possible only when JSON escaping
 *     inflates its body (16 KiB at most) up to sixfold — carries the body as
 *     `bodyBase64`, its UTF-8 bytes in base64, in place of `body`. Base64
 *     grows text by a third whatever it holds, so with the quote (4 KiB,
 *     ~25 KB escaped at worst) the entry fits one page and nothing is lost;
 *     an entry that still does not fit throws.
 *
 * @coordinates-with tools/comments.ts — the `list` action
 * @coordinates-with utils/toolOutput.ts — the bound
 */

import { createHash } from 'node:crypto';
import { MAX_OUTPUT_BYTES, utf8ByteLength } from '../utils/toolOutput.js';

/** Room for the page's own fields (`doc`, `generation`, `nextCursor`, braces). */
const PAGE_OVERHEAD = 1024;
/** Bytes a page's entries may take. */
const PAGE_ENTRY_BYTES = MAX_OUTPUT_BYTES - PAGE_OVERHEAD;
/** The longest comment id a cursor may carry. */
const MAX_CURSOR_ID = 64;

type Entry = Record<string, unknown>;

/** The list as the app answers it. */
export interface CommentList {
  doc: unknown;
  generation: unknown;
  threads: Entry[];
}

/**
 * Where a page starts: thread `comment`, from reply index `reply`, in the
 * document whose digest is `doc`. `continued` says the thread's own fields
 * were on an earlier page, so this page repeats only its identity; a thread
 * starting fresh is always reply 0.
 */
interface Cursor {
  doc: string;
  comment: string;
  reply: number;
  continued: boolean;
}

export type PageResult = { ok: true; page: Entry } | { ok: false; error: string };

const STALE_CURSOR =
  'STALE_COMMENT: the thread this cursor continues was deleted, or the cursor is from another document. Call comments.list again without a cursor.';

/** The digest a cursor carries for the document `doc` names (any JSON value, `null` included). */
function docDigest(doc: unknown): string {
  return createHash('sha256').update(JSON.stringify(doc ?? null)).digest('base64url').slice(0, 22);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ d: cursor.doc, c: cursor.comment, r: cursor.reply, k: cursor.continued }), 'utf8').toString('base64url');
}

/** A cursor `list` returned, or `null` for anything else. */
function decodeCursor(raw: string): Cursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) return null;
    const { d, c, r, k } = value as Record<string, unknown>;
    if (typeof d !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(d)) return null;
    if (typeof c !== 'string' || c.length === 0 || c.length > MAX_CURSOR_ID) return null;
    if (typeof r !== 'number' || !Number.isSafeInteger(r) || r < 0) return null;
    if (typeof k !== 'boolean' || (!k && r !== 0)) return null;
    return { doc: d, comment: c, reply: r, continued: k };
  } catch {
    return null;
  }
}

/**
 * What `entry` adds to a page where its lines sit `indent` spaces deep: its
 * pretty-printed text, every line re-indented, plus separator and margin.
 */
function cost(entry: unknown, indent: number): number {
  const text = JSON.stringify(entry, null, 2) ?? 'null';
  const lines = text.split('\n').length;
  return utf8ByteLength(text) + lines * indent + 8;
}

const THREAD_INDENT = 4;
const REPLY_INDENT = 8;

/**
 * `entry` costing at most `room`, its body moved to `bodyBase64` when it
 * does not fit as text. Throws when that is not enough (the journal's bounds
 * rule it out).
 */
function fitted(entry: Entry, indent: number, room: number): Entry {
  if (cost(entry, indent) <= room) return entry;
  const { body, ...rest } = entry;
  const out = typeof body === 'string' ? { ...rest, bodyBase64: Buffer.from(body, 'utf8').toString('base64') } : entry;
  if (cost(out, indent) > room) throw new Error(`a comments.list entry is ${cost(out, indent)} bytes even with its body base64-encoded, over the ${room}-byte page room`);
  return out;
}

function repliesOf(thread: Entry): Entry[] {
  return Array.isArray(thread.replies) ? (thread.replies as Entry[]) : [];
}

/** The page of `list` starting at `cursor` (the first page without one). */
export function commentsPage(list: CommentList, rawCursor: string | undefined): PageResult {
  if (typeof list !== 'object' || list === null || !Array.isArray(list.threads)) {
    throw new Error('the app answered comments.list without a thread list');
  }
  const threads = list.threads;
  const doc = docDigest(list.doc);
  let start = 0;
  let from = 0;
  let resumed = false;
  if (rawCursor !== undefined) {
    const cursor = decodeCursor(rawCursor);
    if (!cursor) return { ok: false, error: 'cursor is not one comments.list returned' };
    if (cursor.doc !== doc) return { ok: false, error: STALE_CURSOR };
    start = threads.findIndex((t) => t.comment === cursor.comment);
    if (start < 0 || cursor.reply > repliesOf(threads[start]).length) return { ok: false, error: STALE_CURSOR };
    from = cursor.reply;
    resumed = cursor.continued;
  }

  const out: Entry[] = [];
  let used = 0;
  let next: Cursor | undefined;
  for (let i = start; i < threads.length && !next; i++) {
    const thread = threads[i];
    const replies = repliesOf(thread);
    const first = i === start ? from : 0;
    const continued = i === start && resumed;
    let head: Entry = !continued
      ? { ...thread, replies: [] }
      : { comment: thread.comment, state: thread.state, commentGen: thread.commentGen, continued: true, replies: [] };
    if (out.length > 0 && used + cost(head, THREAD_INDENT) > PAGE_ENTRY_BYTES) {
      next = { doc, comment: String(thread.comment), reply: 0, continued: false };
      break;
    }
    head = fitted(head, THREAD_INDENT, PAGE_ENTRY_BYTES - used);
    used += cost(head, THREAD_INDENT);
    const shown: Entry[] = [];
    for (let j = first; j < replies.length; j++) {
      let reply = replies[j];
      if (used + cost(reply, REPLY_INDENT) > PAGE_ENTRY_BYTES) {
        // Alone on a page and still too long: cut its text, never stall.
        if (out.length > 0 || shown.length > 0 || !continued) {
          next = { doc, comment: String(thread.comment), reply: j, continued: true };
          break;
        }
        reply = fitted(reply, REPLY_INDENT, PAGE_ENTRY_BYTES - used);
      }
      used += cost(reply, REPLY_INDENT);
      shown.push(reply);
    }
    const partial = continued || first + shown.length < replies.length;
    out.push(partial ? { ...head, repliesFrom: first, repliesTotal: replies.length, replies: shown } : { ...head, replies: shown });
  }

  const page: Entry = { doc: list.doc, generation: list.generation, threads: out };
  if (next) page.nextCursor = encodeCursor(next);
  const size = utf8ByteLength(JSON.stringify(page, null, 2));
  if (size > MAX_OUTPUT_BYTES) throw new Error(`comments.list page is ${size} bytes, over the ${MAX_OUTPUT_BYTES}-byte bound`);
  return { ok: true, page };
}
