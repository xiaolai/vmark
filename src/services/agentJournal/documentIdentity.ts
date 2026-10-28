/**
 * Document identity for the journal — the key a tab's document is known by,
 * and the revision each tab last learned from the journal (its basis).
 *
 * Key decisions:
 *   - A saved file is `path:<file>` (two windows holding one file contend
 *     for one reservation); an untitled buffer is `tab:<window>/<tab>`.
 *   - The basis is per tab AND key: it is the parent a tab's next prepare
 *     states, so a window that missed another window's commit is refused
 *     `STALE_PARENT` rather than recording its stale buffer over it. A tab
 *     with no basis states none (no CAS). Session memory only: the
 *     journal's document ids are session-scoped too.
 *   - The observed base is what the tab's next SAVE names as its observed
 *     parent: the basis revision, or the tab's own save still pending in
 *     the journal (so saves queued behind a reservation keep their exact
 *     chain). A pending save drops the basis: the prepare must not CAS
 *     against a revision the save is about to supersede.
 *   - A save's observed base is frozen when it is SUBMITTED (see
 *     `saveJournal.ts`); a save submitted while an earlier one is still
 *     outstanding takes the base that earlier one leaves, kept here.
 *   - A budget of `JOURNAL_IDENTITY_BUDGET` tab-and-document entries: past
 *     it the least recently used idle entry is evicted to a bounded
 *     tombstone set, so the tab's next controlled write is refused and
 *     rebases rather than silently stating no parent. An entry held by a
 *     save (outstanding or in flight) is never evicted (it would cut the
 *     chain); when all are held, a new entry's save is refused
 *     (`JOURNAL_DEGRADED`, reported) and its basis not kept (tombstoned).
 *   - A tab's lifecycle token (`journalTabLife`) ends when it closes and is
 *     never reused: work that awaited the journal checks it before writing
 *     back, so a late answer cannot repopulate a closed or reopened tab.
 *   - Save As and rename carry the tab's document (ADR-AL7):
 *     `carryJournalBasis` moves the tab's state.
 *   - A save commits what it learned only if no other write changed the
 *     basis since its submission (`commitSaveBasis`): a controlled edit
 *     that landed during the disk write is the newer truth.
 *   - Each tab and document saves under a window name of its own, released
 *     when the tab closes or the entry is evicted, and never reused.
 *
 * @coordinates-with services/agentJournal/epochClient.ts — releaseWindow
 * @coordinates-with services/agentJournal/journalWindowName.ts — mints the window names
 * @coordinates-with services/agentJournal/documentBinding.ts — the journal side of a move
 * @coordinates-with services/windowClose/tabCleanup.ts — releases a closed tab
 * @module services/agentJournal/documentIdentity
 */

import { journalWarn } from "@/utils/debug";
import { resetJournalBindings } from "./documentBinding";
import { releaseWindow } from "./epochClient";
import type { JournalObservedRef } from "./journalClient";
import { mintJournalWindowName } from "./journalWindowName";

/** Most tab-and-document entries kept; also the tombstone bound. */
export const JOURNAL_IDENTITY_BUDGET = 1024;

const bases = new Map<string, string>();
const observed = new Map<string, JournalObservedRef>();
const outstanding = new Map<string, Promise<JournalObservedRef | null>>();
/** Saves of each tab and document submitted and not yet finished. */
const inFlight = new Map<string, number>();
const windows = new Map<string, string>();
/** Every key with state, least recently used first. */
const live = new Map<string, true>();
const tombstones = new Set<string>();
/** Entries a move carried elsewhere: old → current, never chained; bounded, sparing one a held save reports through. */
const moved = new Map<string, string>();
/** The last basis write by anything but a save's own commit, per entry: a stamp from `stamps`, never reused. */
const foreign = new Map<string, number>();
let stamps = 0;
/** Each open tab's lifecycle token, minted on first use: from `stamps` too, so never reused. */
const lives = new Map<string, number>();

const basisKey = (tabId: string, docKey: string) => JSON.stringify([tabId, docKey]);
const tabOf = (key: string) => (JSON.parse(key) as [string, string])[0];
/**
 * The entry this tab's state for `docKey` lives under now, after any move.
 * Only what work in flight reports back (what it learned, that it finished)
 * follows a move; reads and submissions name the key the tab holds.
 */
const keyOf = (tabId: string, docKey: string) => {
  const key = basisKey(tabId, docKey);
  return moved.get(key) ?? key;
};

function drop(key: string): void {
  for (const map of [foreign, bases, observed, outstanding, live]) map.delete(key);
  const name = windows.get(key);
  windows.delete(key);
  if (name !== undefined) {
    void releaseWindow(name).catch((error: unknown) => journalWarn("could not release a journal window:", name, error));
  }
}

const held = (key: string) => outstanding.has(key) || inFlight.has(key);
function evict(key: string): void {
  drop(key);
  tombstones.add(key);
  if (tombstones.size > JOURNAL_IDENTITY_BUDGET) tombstones.delete(tombstones.values().next().value as string);
}

/** Mark `key` used and evict idle entries past the budget; `false` when `key` itself could not be kept. */
function touch(key: string): boolean {
  tombstones.delete(key);
  live.delete(key);
  live.set(key, true);
  for (const oldest of live.keys()) {
    if (live.size <= JOURNAL_IDENTITY_BUDGET) return true;
    // @edge-case A save still outstanding or in flight keeps its entry: its
    // successor must still chain on it.
    if (oldest !== key && !held(oldest)) evict(oldest);
  }
  // @edge-case Every other entry is held: an idle newcomer is refused.
  if (live.size <= JOURNAL_IDENTITY_BUDGET || held(key)) return true;
  evict(key);
  return false;
}

/** The journal key of a tab's document. */
export function docKeyFor(tab: { tabId: string; filePath: string | null }, windowLabel: string): string {
  return tab.filePath ? `path:${tab.filePath}` : `tab:${windowLabel}/${tab.tabId}`;
}

/** The revision this tab last learned for `docKey`, or `null`. */
export function journalBasis(tabId: string, docKey: string): string | null {
  return bases.get(basisKey(tabId, docKey)) ?? null;
}

/** Record that this tab's buffer is now at `revision`. */
export function rememberJournalBasis(tabId: string, docKey: string, revision: string): void {
  foreign.set(keyOf(tabId, docKey), ++stamps);
  if (!touch(keyOf(tabId, docKey))) return;
  bases.set(keyOf(tabId, docKey), revision);
  observed.set(keyOf(tabId, docKey), { ref: "revision", revision });
}

/** Record that this tab's last save is pending in the journal as `observation`. */
export function rememberPendingSave(tabId: string, docKey: string, observation: string): void {
  if (!touch(keyOf(tabId, docKey))) return;
  bases.delete(keyOf(tabId, docKey));
  observed.set(keyOf(tabId, docKey), { ref: "pending", observation });
}

/** What this tab's next save is built on, or `null` (the journal's head). */
export function journalObservedBase(tabId: string, docKey: string): JournalObservedRef | null {
  return observed.get(basisKey(tabId, docKey)) ?? null;
}

/** Drop the basis and observed base (after `STALE_PARENT`, so the next write rebases). */
export function forgetJournalBasis(tabId: string, docKey: string): void {
  foreign.set(keyOf(tabId, docKey), ++stamps);
  bases.delete(keyOf(tabId, docKey));
  observed.delete(keyOf(tabId, docKey));
  tombstones.delete(keyOf(tabId, docKey));
}

/** Where the basis of this tab's `docKey` stands now; a save takes it at submission. */
export function basisStamp(tabId: string, docKey: string): number {
  return foreign.get(basisKey(tabId, docKey)) ?? 0;
}

/**
 * Commit what a save learned (`next`: its revision, its pending
 * observation, or `null` to drop the basis) only while no other write has
 * changed the basis since `stamp`. `false`: a newer write's basis stands.
 */
export function commitSaveBasis(tabId: string, docKey: string, stamp: number, next: JournalObservedRef | null): boolean {
  const key = keyOf(tabId, docKey);
  if ((foreign.get(key) ?? 0) !== stamp) return false;
  if (next === null) {
    bases.delete(key);
    observed.delete(key);
    tombstones.delete(key);
    return true;
  }
  if (!touch(key)) return true;
  if (next.ref === "revision") bases.set(key, next.revision);
  else bases.delete(key);
  observed.set(key, next);
  return true;
}

/** The key this tab's state for `docKey` lives under now: `docKey`, or where a move carried it. */
export function journalKeyNow(tabId: string, docKey: string): string {
  return (JSON.parse(keyOf(tabId, docKey)) as [string, string])[1];
}

/** This tab's basis for `docKey` was evicted by the budget and not relearned since. */
export function isJournalBasisEvicted(tabId: string, docKey: string): boolean {
  return tombstones.has(basisKey(tabId, docKey));
}

/** The journal window name this tab saves `docKey` under; minted once, never reused; `null` when none can be minted. */
export function windowNameFor(tabId: string, docKey: string, windowLabel: string): string | null {
  const key = basisKey(tabId, docKey);
  const name = windows.get(key) ?? mintJournalWindowName(windowLabel, tabId);
  if (name !== null) windows.set(key, name);
  touch(key);
  return name;
}

/** This tab's lifecycle token: the same until the tab closes, never reused after. */
export function journalTabLife(tabId: string): number {
  let life = lives.get(tabId);
  if (life === undefined) lives.set(tabId, (life = ++stamps));
  return life;
}

/** The tab has not closed since `life` was taken. */
export function isJournalTabLive(tabId: string, life: number): boolean {
  return lives.get(tabId) === life;
}

/** A tab closed: forget all of its journal state, end its lifecycle and release its window names. Idempotent. */
export function releaseTabJournal(tabId: string): void {
  lives.delete(tabId);
  for (const key of [...live.keys(), ...windows.keys()]) {
    if (tabOf(key) === tabId) drop(key);
  }
  for (const key of [...tombstones]) if (tabOf(key) === tabId) tombstones.delete(key);
  for (const key of [...moved.keys()]) if (tabOf(key) === tabId) moved.delete(key);
}

/**
 * The observed base this tab's newest outstanding save of `docKey` will leave
 * once it is recorded or cancelled, or `null` when none is outstanding.
 */
export function outstandingSaveBase(tabId: string, docKey: string): Promise<JournalObservedRef | null> | null {
  return outstanding.get(basisKey(tabId, docKey)) ?? null;
}

/** Make `settled` the newest outstanding save of this tab's `docKey`. */
export function setOutstandingSaveBase(tabId: string, docKey: string, settled: Promise<JournalObservedRef | null>): void {
  outstanding.set(basisKey(tabId, docKey), settled);
}

/** `settled` is done; forget it unless a newer save already chained behind it. */
export function clearOutstandingSaveBase(tabId: string, docKey: string, settled: Promise<JournalObservedRef | null>): void {
  if (outstanding.get(keyOf(tabId, docKey)) === settled) outstanding.delete(keyOf(tabId, docKey));
}

/** Count one more save of this tab's `docKey` in flight; `false` past `limit`, or for a new entry when saves hold the whole budget. */
export function admitOutstandingSave(tabId: string, docKey: string, limit: number): boolean {
  const key = basisKey(tabId, docKey);
  const count = inFlight.get(key) ?? 0;
  if (count >= limit) return false;
  if (!held(key) && new Set([...inFlight.keys(), ...outstanding.keys()]).size >= JOURNAL_IDENTITY_BUDGET) {
    journalWarn(`every one of the ${JOURNAL_IDENTITY_BUDGET} journal identity entries is held by a save; this save is not recorded`);
    return false;
  }
  inFlight.set(key, count + 1);
  touch(key);
  return true;
}

/** One admitted save of this tab's `docKey` finished. Call once per admission. */
export function finishOutstandingSave(tabId: string, docKey: string): void {
  const key = keyOf(tabId, docKey);
  const left = (inFlight.get(key) ?? 1) - 1;
  if (left > 0) inFlight.set(key, left);
  else inFlight.delete(key);
}

/** Forget every basis and outstanding save. For tests. */
export function resetJournalBases(): void {
  for (const map of [inFlight, bases, observed, outstanding, windows, live, moved, foreign, lives]) map.clear();
  tombstones.clear();
  resetJournalBindings();
}

/**
 * Move this tab's journal state from `from` to `to`, unless `to` already has
 * its own; release `from`. Saves in flight count against `to`, and later
 * calls naming `from` reach `to`.
 */
export function carryJournalBasis(tabId: string, from: string, to: string): void {
  if (from === to) return;
  const [src, dst] = [basisKey(tabId, from), basisKey(tabId, to)];
  // `to` is the tab's own again; whatever pointed at `from` now points at `to`.
  moved.delete(dst);
  for (const [old, now] of moved) if (now === src) moved.set(old, dst);
  moved.set(src, dst);
  for (const [old, now] of moved) if (moved.size > JOURNAL_IDENTITY_BUDGET && !held(now)) moved.delete(old);
  // A save submitted on `from` commits on `to`: the stamp it took moves too.
  const stamp = foreign.get(src);
  if (stamp === undefined) foreign.delete(dst);
  else foreign.set(dst, stamp);
  const saving = (inFlight.get(src) ?? 0) + (inFlight.get(dst) ?? 0);
  inFlight.delete(src);
  if (saving > 0) inFlight.set(dst, saving);
  if (!live.has(dst) && !outstanding.has(dst)) {
    const basis = bases.get(src);
    const seen = observed.get(src);
    const chain = outstanding.get(src);
    if (chain !== undefined) outstanding.set(dst, chain);
    const kept = basis !== undefined || seen !== undefined || saving > 0 || chain !== undefined ? touch(dst) : false;
    if (kept && basis !== undefined) bases.set(dst, basis);
    if (kept && seen !== undefined) observed.set(dst, seen);
  }
  drop(src);
  tombstones.delete(src);
}
