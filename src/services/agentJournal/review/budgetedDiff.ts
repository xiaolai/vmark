/**
 * Budgeted diff — runs the exact canonical diff in a terminable module
 * worker under a hard deadline, and returns ONE coarse "too complex to
 * split" change when it cannot finish in time.
 *
 * Key decisions:
 *   - The deadline counts from the CALL: validation, a wait for a ready
 *     worker, or behind an earlier job, is charged to it. A timer at
 *     `deadlineMs − COARSE_RESERVE_MS` settles the job, leaving the reserve
 *     for the coarse fallback (`coarseDiff`), which trims only within it. A
 *     reply handled at or past that point is expired, never accepted.
 *   - This module's own linear checks (input well-formedness, a result's
 *     canonical form) run on the caller's thread, inside the budget: they
 *     read the clock every `CHECK_CHUNK` units and stop at the settle point.
 *     An input scan cut short settles coarse, equal texts included, without
 *     proving the texts well-formed (a coarse change is offsets only; only a
 *     COMPLETED scan's lone surrogate is INVALID_TEXT). A result check cut
 *     short settles coarse and keeps the worker, which has answered.
 *   - At the deadline a dispatched worker is terminated (nothing else stops
 *     a running diff) and the warm spare promoted; its replacement spawns
 *     after the caller has its result. A merely warming worker is kept.
 *   - One job in flight at a time, in call order. Messages from a retired
 *     worker, or for an id that is not in flight, are ignored.
 *   - A worker's result is re-checked with `assertCanonical`; a malformed
 *     or non-canonical one is refused as `invalidResult`. Spawn failures (a
 *     factory throw, or an error before `ready`: how a CSP refusal or a
 *     module load failure surfaces), worker failures and invalid results
 *     are logged with `journalWarn` and counted in `status()`; the call
 *     still gets the coarse change. A later call retries the spawn.
 *   - `ownMs`: time in this module's own callbacks for a job after the call
 *     returned, so a deadline check charges it rather than blame the caller.
 *
 * @coordinates-with ./diffBudget.ts — its constants, worker factory and result types
 * @coordinates-with ./diffWorker.ts — the worker entry
 * @coordinates-with ./diffProtocol.ts — the messages exchanged
 * @module services/agentJournal/review/budgetedDiff
 */

import { journalWarn } from "@/utils/debug/warn";
import { coarseDiff } from "./coarseDiff";
import { parseDiffReply, type DiffRequest } from "./diffProtocol";
import { OverBudget, assertCanonical, assertWellFormed, type TextChange } from "./textChanges";
import {
  COARSE_RESERVE_MS,
  DIFF_DEADLINE_MS,
  createDiffWorker,
  type BudgetedDiffOptions,
  type DiffOutcome,
  type DiffStatus,
  type DiffWorkerFactory,
  type DiffWorkerLike,
  type Job,
  type Slot,
  type TooComplexReason,
} from "./diffBudget";

export class BudgetedDiff {
  readonly #factory: DiffWorkerFactory;
  readonly #warn: (...args: unknown[]) => void;
  readonly #now: () => number;
  #primary: Slot | null = null;
  #spare: Slot | null = null;
  readonly #queue: Job[] = [];
  #inFlight: Job | null = null;
  #seq = 0;
  #closed = false;
  #lastSpawnFailed = false;
  #counts = { spawnFailures: 0, timeouts: 0, workerFailures: 0, invalidResults: 0, respawns: 0 };
  #lastSpawnError: string | null = null;

  constructor({ factory = createDiffWorker, warn = journalWarn, now = () => performance.now() }: BudgetedDiffOptions = {}) {
    this.#factory = factory;
    this.#warn = warn;
    this.#now = now;
  }

  /** Diff `a` → `b` within `deadlineMs` of this call. Rejects INVALID_TEXT; throws RangeError on a bad deadline. */
  diff(a: string, b: string, { deadlineMs = DIFF_DEADLINE_MS }: { deadlineMs?: number } = {}): Promise<DiffOutcome> {
    if (!(Number.isFinite(deadlineMs) && deadlineMs > COARSE_RESERVE_MS)) {
      throw new RangeError(`deadlineMs must be a finite number above ${COARSE_RESERVE_MS}, got ${deadlineMs}`);
    }
    if (this.#closed) return Promise.reject(new Error("budgeted diff is closed"));
    const t0 = this.#now();
    const settleAt = t0 + deadlineMs - COARSE_RESERVE_MS;
    let scanned = true;
    try {
      assertWellFormed(a, b, { until: settleAt, now: this.#now });
    } catch (e) {
      if (!(e instanceof OverBudget)) return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      scanned = false; // past the settle point: the job below expires at once
    }
    const checked = this.#now();
    if (scanned && a === b) return Promise.resolve({ mode: "exact", changes: [], elapsedMs: checked - t0, readyWaitMs: 0, dispatched: false, ownMs: 0 });
    return new Promise((resolve) => {
      const job: Job = { id: ++this.#seq, a, b, t0, settleAt, resolve, timer: undefined, readyWaitMs: null, slot: null, ownMs: 0 };
      job.timer = setTimeout(() => this.#expire(job, this.#now()), Math.max(0, Math.ceil(job.settleAt - checked)));
      if (checked >= job.settleAt) return this.#expire(job, checked);
      this.#queue.push(job);
      this.#pump();
    });
  }

  /** Start the primary worker and its spare ahead of the first call. */
  warm(): void {
    if (!this.#closed) this.#ensurePrimary();
  }

  status(): DiffStatus {
    const p = this.#primary;
    const state = this.#closed ? "closed" : p?.ready ? "ready" : p ? "starting" : this.#lastSpawnFailed ? "unavailable" : "idle";
    return { state, spareReady: this.#spare?.ready ?? false, lastSpawnError: this.#lastSpawnError, ...this.#counts };
  }

  /** Terminate every worker; pending calls settle with the coarse change. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    const pending = [...(this.#inFlight ? [this.#inFlight] : []), ...this.#queue.splice(0)];
    this.#inFlight = null;
    for (const job of pending) this.#coarse(job, "workerUnavailable", this.#now());
    for (const slot of [this.#primary, this.#spare]) if (slot) this.#retire(slot);
    this.#primary = this.#spare = null;
  }

  #spawn(): Slot | null {
    let worker: DiffWorkerLike;
    try {
      worker = this.#factory();
    } catch (e) {
      this.#spawnFailed(e instanceof Error ? e.message : String(e));
      return null;
    }
    this.#lastSpawnFailed = false;
    const slot: Slot = {
      worker,
      ready: false,
      retired: false,
      onMessage: (event) => this.#onMessage(slot, event.data),
      onError: (event) => this.#onError(slot, event.message || "worker error"),
    };
    worker.addEventListener("message", slot.onMessage);
    worker.addEventListener("error", slot.onError);
    return slot;
  }

  #spawnFailed(message: string): void {
    this.#counts.spawnFailures++;
    this.#lastSpawnError = message;
    this.#lastSpawnFailed = true;
    this.#warn("diff worker spawn failed; review diffs fall back to one coarse change:", message);
  }

  #ensurePrimary(): Slot | null {
    this.#primary ??= this.#spawn();
    if (this.#primary && !this.#spare) this.#spare = this.#spawn();
    return this.#primary;
  }

  #retire(slot: Slot): void {
    slot.retired = true;
    slot.worker.removeEventListener("message", slot.onMessage);
    slot.worker.removeEventListener("error", slot.onError);
    slot.worker.terminate();
  }

  /** Retire the primary, promote the spare, and refill and resume after the current callback. */
  #replacePrimary(): void {
    if (this.#primary) this.#retire(this.#primary);
    this.#primary = this.#spare;
    this.#spare = null;
    this.#counts.respawns++;
    setTimeout(() => {
      if (this.#closed) return;
      if (this.#primary && !this.#spare) this.#spare = this.#spawn();
      this.#pump();
    }, 0);
  }

  #pump(): void {
    if (this.#closed || this.#inFlight || this.#queue.length === 0) return;
    const slot = this.#ensurePrimary();
    if (!slot) {
      for (const job of this.#queue.splice(0)) this.#coarse(job, "workerUnavailable", this.#now());
      return;
    }
    if (!slot.ready) return;
    const job = this.#queue.shift() as Job;
    const start = this.#now();
    this.#inFlight = job;
    job.slot = slot;
    job.readyWaitMs = start - job.t0;
    const request: DiffRequest = { type: "diff", id: job.id, a: job.a, b: job.b };
    slot.worker.postMessage(request);
    const end = this.#now();
    job.ownMs += end - start;
    if (end >= job.settleAt) this.#expire(job, end);
  }

  #onMessage(slot: Slot, data: unknown): void {
    if (slot.retired) return;
    const start = this.#now();
    const reply = parseDiffReply(data);
    const job = this.#inFlight?.slot === slot ? this.#inFlight : null;
    if (reply?.type === "ready") {
      slot.ready = true;
      if (slot === this.#primary) this.#pump();
      return;
    }
    if (!reply) {
      this.#counts.invalidResults++;
      this.#warn("diff worker sent a malformed reply:", data);
      if (job) this.#finish(() => this.#coarse(job, "invalidResult", start));
      return;
    }
    if (!job || reply.id !== job.id) return;
    if (start >= job.settleAt) return this.#expire(job, start);
    if (reply.type === "failed") {
      this.#counts.workerFailures++;
      this.#warn("diff worker failed a diff:", reply.message);
      this.#finish(() => this.#coarse(job, "workerFailed", start));
      return;
    }
    try {
      assertCanonical(job.a, job.b, reply.changes, { until: job.settleAt, now: this.#now });
    } catch (e) {
      if (e instanceof OverBudget) {
        // The worker answered and stays warm; only the check ran out of time.
        this.#counts.timeouts++;
        this.#finish(() => this.#coarse(job, "deadline", start));
        return;
      }
      this.#counts.invalidResults++;
      this.#warn("diff worker returned an invalid result:", e instanceof Error ? e.message : String(e));
      this.#finish(() => this.#coarse(job, "invalidResult", start));
      return;
    }
    this.#finish(() => this.#settle(job, { mode: "exact", changes: reply.changes }, start));
  }

  #onError(slot: Slot, message: string): void {
    if (slot.retired) return;
    const start = this.#now();
    if (!slot.ready) {
      this.#retire(slot);
      this.#spawnFailed(message);
      if (slot === this.#spare) this.#spare = null;
      if (slot !== this.#primary) return;
      this.#primary = this.#spare;
      this.#spare = null;
      for (const job of this.#queue.splice(0)) this.#coarse(job, "workerUnavailable", start);
      return;
    }
    this.#counts.workerFailures++;
    this.#warn("diff worker crashed; it is replaced:", message);
    if (slot === this.#spare) {
      this.#retire(slot);
      this.#spare = null;
      return;
    }
    const job = this.#inFlight?.slot === slot ? this.#inFlight : null;
    this.#inFlight = null;
    this.#replacePrimary();
    if (job) this.#coarse(job, "workerFailed", start);
  }

  /** The settle timer, or a dispatch that ended past the settle point. */
  #expire(job: Job, start: number): void {
    if (job.timer === undefined) return;
    this.#counts.timeouts++;
    const queued = this.#queue.indexOf(job);
    if (queued >= 0) this.#queue.splice(queued, 1);
    if (this.#inFlight === job) {
      this.#inFlight = null;
      this.#replacePrimary();
    }
    this.#coarse(job, "deadline", start);
  }

  /** Settle the in-flight job, then start the next. */
  #finish(settle: () => void): void {
    this.#inFlight = null;
    settle();
    this.#pump();
  }

  #coarse(job: Job, reason: TooComplexReason, start: number): void {
    // Half the reserve trims; the rest settles.
    this.#settle(job, { mode: "tooComplex", reason, changes: coarseDiff(job.a, job.b, job.settleAt + COARSE_RESERVE_MS / 2, this.#now) }, start);
  }

  #settle(job: Job, result: { mode: "exact"; changes: TextChange[] } | { mode: "tooComplex"; reason: TooComplexReason; changes: TextChange[] }, start: number): void {
    if (job.timer === undefined) return;
    clearTimeout(job.timer);
    job.timer = undefined;
    const end = this.#now();
    job.ownMs += end - start;
    const elapsedMs = end - job.t0;
    job.resolve({ ...result, elapsedMs, readyWaitMs: job.readyWaitMs ?? elapsedMs, dispatched: job.slot !== null, ownMs: job.ownMs });
  }
}
