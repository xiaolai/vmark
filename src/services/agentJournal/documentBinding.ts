/**
 * Document binding — carry a tab's journal document to its new key on Save
 * As or rename (ADR-AL7), hold work on either key until that lands, and
 * fail closed when it cannot.
 *
 * Key decisions:
 *   - Once per pair: a repeated `from → to` answers the running (or
 *     settled) bind instead of moving again.
 *   - A bind sharing a key with a running one runs after it: `B → C` must
 *     not move B before `A → B` has put A's document there.
 *   - A failed bind leaves the destination UNBOUND: the journal still holds
 *     the document under its source, so anything recorded under the
 *     destination would start a second, split history. Readiness answers
 *     the refusal until a bind there lands; callers then send nothing
 *     (no arm, capture or prepare) and keep the tab's state on the source.
 *     The key is marked in the recording store (suspended recording) until
 *     then — across retries, tab close and reopen.
 *   - The original source is kept (`journalBindOrigin`): recovery binds it
 *     straight to where the tab is now. A move out of an unbound key never
 *     reaches the journal (it has no document of its own there); the
 *     destination inherits the origin and becomes the unbound key. A move
 *     back to the origin is bound already.
 *   - The callers name the key the tab's document is at NOW (`saveJournal`
 *     resolves it when the save runs): this module never rebases a source
 *     itself, because another tab may hold that key again by then.
 *   - Unbound keys are never forgotten to make room: dropping one would make
 *     its readiness answer bound with no bind, splitting its history. They
 *     are only created by a failed Save As or rename, each shown as a
 *     warning until cleared, so the user's own actions bound them.
 *   - A landed bind caches the id the journal replied for the destination,
 *     never the expectation it sent: a bind from a key with no document
 *     mints a fresh one, and a stale cached id there would make the next
 *     bind out of the destination expect the wrong document.
 *   - Every bind is a compare-and-set (`expectedDoc`), so the journal
 *     itself refuses it if the source was reused meanwhile (another window,
 *     the file watcher), which this module cannot see. The expectation is
 *     the source's id when known (`noteJournalDocument`: arm and capture
 *     replies); otherwise a read-only lookup (`findDocument`, which never
 *     mints) names it, or that the source carries none. A failed lookup
 *     fails closed: no bind is sent unchecked.
 *   - Recovery never moves a replacement identity. A failed bind pins the
 *     expectation it carried (an id, or none) to the unbound key for the
 *     whole suspension: never evicted, never replaced by a later cache value,
 *     lookup or failed retry, and the recovery bind names it. Recovery is
 *     refused, and the destination stays unbound, once the origin's document
 *     has left it (a bind out of the origin landed here, or the origin is
 *     known to hold something else) or when the lookup itself failed: with
 *     no expectation, any move could carry a replacement.
 *
 * Known limitations: a destination whose first lookup failed stays unbound
 * until the tab moves back to the origin.
 *
 * @coordinates-with services/agentJournal/documentIdentity.ts — the tab's state that moves with it
 * @coordinates-with services/agentJournal/epochClient.ts — bindDocument, findDocument
 * @coordinates-with stores/journalRecordingStore.ts — the unbound marks
 * @module services/agentJournal/documentBinding
 */

import { journalWarn } from "@/utils/debug";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { bindDocument, findDocument } from "./epochClient";
import { JournalRefusal, toJournalRefusal } from "./journalRefusal";

/** Whether a key's journal document is where its tab is; the refusal when it is not. */
export type JournalBindResult = { ok: true } | { ok: false; refusal: JournalRefusal };

/** Most pairs remembered for once-per-pair binding, and most document ids remembered; past it the oldest is forgotten. */
const BIND_MEMORY = 1024;

const BOUND: JournalBindResult = { ok: true };

/** The source's document could not be looked up: there is no expectation to bind with. */
const UNKNOWN = Symbol("unknown source document");

/** Why a destination is unbound: the key still holding its document, what the bind expected there, and the refusal. */
interface Unbound {
  origin: string;
  /** The origin's document id, `null` when it carried none, or `UNKNOWN` when the lookup failed. */
  expected: string | null | typeof UNKNOWN;
  refusal: JournalRefusal;
  /** The origin's document has left it since: recovering from the origin would move a replacement. */
  originLeft: boolean;
}

/** Binds still running, under both their keys. */
const binds = new Map<string, Promise<JournalBindResult>>();
/** The last destination each key was bound to (bounded). */
const lastBind = new Map<string, string>();
/** Unbound keys. Never evicted: see the header. */
const unbound = new Map<string, Unbound>();
/** The journal document id each key was last seen to hold (bounded). */
const knownDocs = new Map<string, string>();

const setMark = (docKey: string, marked: boolean) => useJournalRecordingStore.getState().setUnbound(docKey, marked);

function markUnbound(to: string, entry: Unbound): void {
  unbound.set(to, entry);
  setMark(to, true);
}

function clearUnbound(docKey: string): void {
  if (unbound.delete(docKey)) setMark(docKey, false);
}

/** Remember that `docKey` holds journal document `doc` (an arm or capture reply named it). */
export function noteJournalDocument(docKey: string, doc: string): void {
  knownDocs.delete(docKey);
  knownDocs.set(docKey, doc);
  if (knownDocs.size > BIND_MEMORY) knownDocs.delete(knownDocs.keys().next().value as string);
  for (const entry of unbound.values()) {
    if (entry.origin === docKey && entry.expected !== UNKNOWN && entry.expected !== doc) entry.originLeft = true;
  }
}

/** A bind `from → to` landed: `doc`, the id the journal replied, is at `to` now. */
function landed(from: string, to: string, doc: string): void {
  clearUnbound(to);
  knownDocs.delete(from);
  noteJournalDocument(to, doc);
  for (const entry of unbound.values()) if (entry.origin === from) entry.originLeft = true;
}

/** `docKey`'s state once every running bind of it has settled. */
function statusOf(docKey: string): JournalBindResult {
  const entry = unbound.get(docKey);
  return entry ? { ok: false, refusal: entry.refusal } : BOUND;
}

/** Run the bind of `from → to` (every earlier bind of either key has settled). */
async function run(from: string, to: string): Promise<JournalBindResult> {
  const prior = unbound.get(from);
  if (prior) {
    // @edge-case `from` holds no document of its own: moving it would carry a
    // fresh one over `to`. Recovery binds the origin instead.
    clearUnbound(from);
    if (lastBind.get(from) === to) lastBind.delete(from);
    if (prior.origin === to) return BOUND;
    markUnbound(to, prior);
    return { ok: false, refusal: prior.refusal };
  }
  const pending = unbound.get(to);
  // @edge-case The origin's document moved elsewhere (and the origin may hold
  // a reopened file's document now): binding it here would steal that one.
  if (pending && pending.origin === from && pending.originLeft) {
    if (lastBind.get(from) === to) lastBind.delete(from);
    journalWarn("not recovering a document's journal history: its original document moved elsewhere; recording stays suspended:", from, to);
    return { ok: false, refusal: pending.refusal };
  }
  // Every bind names what the source carries (compare and set): the journal
  // refuses the move if the source no longer holds it. A recovery names the
  // expectation pinned at the original failure, never a later value.
  let expected: string | null;
  if (pending?.origin === from) {
    // @edge-case The failed bind's source could not be looked up: with no
    // expectation, any move could carry whatever the origin holds by now.
    if (pending.expected === UNKNOWN) {
      if (lastBind.get(from) === to) lastBind.delete(from);
      journalWarn("not recovering a document's journal history: its document could not be looked up; recording stays suspended:", from, to);
      return { ok: false, refusal: pending.refusal };
    }
    expected = pending.expected;
  } else {
    const known = knownDocs.get(from);
    try {
      expected = known ?? (await findDocument(from));
    } catch (error: unknown) {
      return failed(from, to, UNKNOWN, error, "could not look up a document's journal history to carry it to its new name; recording there is suspended:");
    }
  }
  try {
    landed(from, to, await bindDocument(from, to, expected));
    return BOUND;
  } catch (error: unknown) {
    return failed(from, to, expected, error, "could not carry a document's journal history to its new name; recording there is suspended:");
  }
}

/** A bind `from → to` failed (the lookup, or the move): `to` is unbound until a bind there lands. */
function failed(from: string, to: string, expected: Unbound["expected"], error: unknown, why: string): JournalBindResult {
  const refusal = toJournalRefusal(error);
  if (lastBind.get(from) === to) lastBind.delete(from);
  markUnbound(to, { origin: from, expected, refusal, originLeft: false });
  journalWarn(why, from, to, refusal.journalCode, refusal.message);
  return { ok: false, refusal };
}

/** Carry `from`'s journal document to `to` (Save As, rename). Once per pair; never rejects. */
export function bindJournalDocument(from: string, to: string): Promise<JournalBindResult> {
  if (from === to || lastBind.get(from) === to) return journalDocumentReady(to);
  lastBind.delete(from);
  // `to` holds a document again: its own earlier move no longer answers for it.
  lastBind.delete(to);
  lastBind.set(from, to);
  if (lastBind.size > BIND_MEMORY) lastBind.delete(lastBind.keys().next().value as string);
  // Each key's entry is its newest bind, which settles after every earlier one of the key.
  const running = [binds.get(from), binds.get(to)].filter((p): p is Promise<JournalBindResult> => p !== undefined);
  const settled: Promise<JournalBindResult> = Promise.all(running)
    .then(() => run(from, to))
    .then((result) => {
      for (const key of [from, to]) if (binds.get(key) === settled) binds.delete(key);
      return result;
    });
  binds.set(from, settled);
  binds.set(to, settled);
  return settled;
}

/** Once no bind of `docKey` is running: whether its document is there (never rejects). */
export async function journalDocumentReady(docKey: string): Promise<JournalBindResult> {
  let running = binds.get(docKey);
  while (running) {
    await running;
    const next = binds.get(docKey);
    running = next === running ? undefined : next;
  }
  return statusOf(docKey);
}

/** A bind to `docKey` failed and none has landed since: recording there is suspended. */
export function isJournalDocumentUnbound(docKey: string): boolean {
  return unbound.has(docKey);
}

/** The key still holding `docKey`'s document while a bind to it runs or has failed; `null` once bound. */
export function journalBindOrigin(docKey: string): string | null {
  const entry = unbound.get(docKey);
  if (entry) return entry.origin;
  if (!binds.has(docKey)) return null;
  for (const [from, to] of lastBind) if (to === docKey && from !== docKey) return from;
  return null;
}

/** Forget every bind, unbound key and known document. For tests, through `resetJournalBases`. */
export function resetJournalBindings(): void {
  binds.clear();
  lastBind.clear();
  knownDocs.clear();
  for (const key of [...unbound.keys()]) clearUnbound(key);
}
