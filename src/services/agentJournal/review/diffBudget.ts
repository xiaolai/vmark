/**
 * Diff budget — the constants, worker factory, result and bookkeeping types
 * of the budgeted diff: how long a diff may take, how the worker is loaded, and
 * what a caller gets back.
 *
 * @coordinates-with ./budgetedDiff.ts — the class these describe
 * @module services/agentJournal/review/diffBudget
 */

import type { TextChange } from "./textChanges";

/** The default deadline for one diff, from the call. */
export const DIFF_DEADLINE_MS = 200;
/** Time reserved after the settle point for the coarse fallback and promise resolution. */
export const COARSE_RESERVE_MS = 20;

type WorkerListener = (event: { data?: unknown; message?: string }) => void;

/** The slice of a `Worker` the budgeted diff uses. */
export interface DiffWorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  addEventListener(type: "message" | "error", listener: WorkerListener): void;
  removeEventListener(type: "message" | "error", listener: WorkerListener): void;
}

export type DiffWorkerFactory = () => DiffWorkerLike;

/** The production factory: the module worker loaded by URL (the CSP refuses blob workers). */
export function createDiffWorker(): DiffWorkerLike {
  return new Worker(new URL("./diffWorker.ts", import.meta.url), { type: "module" }) as unknown as DiffWorkerLike;
}

export type TooComplexReason = "deadline" | "workerFailed" | "workerUnavailable" | "invalidResult";

interface OutcomeTiming {
  readonly changes: TextChange[];
  readonly elapsedMs: number;
  /** Time from the call until the job was dispatched (the whole elapsed time when it never was). */
  readonly readyWaitMs: number;
  readonly dispatched: boolean;
  readonly ownMs: number;
}

export type DiffOutcome =
  | ({ readonly mode: "exact" } & OutcomeTiming)
  | ({ readonly mode: "tooComplex"; readonly reason: TooComplexReason } & OutcomeTiming);

export interface DiffStatus {
  readonly state: "idle" | "starting" | "ready" | "unavailable" | "closed";
  readonly spareReady: boolean;
  readonly spawnFailures: number;
  readonly lastSpawnError: string | null;
  readonly timeouts: number;
  /** Worker crashes and failed replies (a failed canonical assertion in the worker lands here). */
  readonly workerFailures: number;
  /** Malformed or non-canonical results refused on this thread. */
  readonly invalidResults: number;
  readonly respawns: number;
}

export interface BudgetedDiffOptions {
  readonly factory?: DiffWorkerFactory;
  readonly warn?: (...args: unknown[]) => void;
  readonly now?: () => number;
}

/** A worker the budgeted diff holds, and its listeners. */
export interface Slot {
  readonly worker: DiffWorkerLike;
  ready: boolean;
  retired: boolean;
  readonly onMessage: WorkerListener;
  readonly onError: WorkerListener;
}

/** One diff call, from the call until it settles. */
export interface Job {
  readonly id: number;
  readonly a: string;
  readonly b: string;
  readonly t0: number;
  readonly settleAt: number;
  readonly resolve: (outcome: DiffOutcome) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  readyWaitMs: number | null;
  slot: Slot | null;
  ownMs: number;
}
