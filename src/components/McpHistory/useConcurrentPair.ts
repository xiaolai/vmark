/**
 * Concurrent pair loader — loads, on demand, both diffs of a revision edited
 * in two windows: the saving window's own change (observed before → result)
 * and the change against the version before it (linear before → result).
 *
 * Key decisions:
 *   - Nothing is read until the pair is opened. A loaded pair is kept for
 *     the life of the row, so hiding and showing it again reads nothing; a
 *     failed read is forgotten on hide, so the next open retries.
 *   - What is open and loaded belongs to one document and revision: a row
 *     handed another (a reused revision id on another document) starts
 *     closed and idle.
 *   - Each load has its own token: a reply that lands after the pair was
 *     hidden, after the identity changed, or after the row unmounted, is
 *     dropped rather than shown.
 *   - The diffs run in the review's budgeted worker (`BudgetedDiff`) with
 *     `PAIR_DEADLINE_MS` per diff, one after the other: the worker runs one
 *     job at a time, so asking for both at once would spend the second's
 *     deadline queued behind the first. One the worker cannot finish, or
 *     cannot start, comes back as one coarse change and is marked
 *     `coarse`. The worker pair is closed when the load ends.
 *   - What is shown is bounded by `pairDiffView` whatever the document size.
 *
 * @coordinates-with services/agentJournal/concurrentPairClient.ts — the read
 * @coordinates-with services/agentJournal/review/budgetedDiff.ts — the diff
 * @coordinates-with components/McpHistory/pairDiffView.ts — the bounded layout
 * @module components/McpHistory/useConcurrentPair
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { readConcurrentPair } from "@/services/agentJournal/concurrentPairClient";
import { BudgetedDiff } from "@/services/agentJournal/review/budgetedDiff";
import type { DiffOutcome } from "@/services/agentJournal/review/diffBudget";
import { journalWarn } from "@/utils/debug";
import { diffView, type DiffView } from "./pairDiffView";

/** How long one of the two diffs may take, from its own call, before it is shown coarse. */
const PAIR_DEADLINE_MS = 1_000;

export interface PairDiff {
  readonly view: DiffView;
  /** The worker could not split the change; it is shown as one. */
  readonly coarse: boolean;
}

export type PairLoad =
  | { readonly status: "idle" }
  | { readonly status: "loading" }
  | { readonly status: "failed" }
  | { readonly status: "ready"; readonly fromStart: PairDiff; readonly against: PairDiff };

const pairDiff = (a: string, b: string, outcome: DiffOutcome): PairDiff => ({
  view: diffView(a, b, outcome.changes),
  coarse: outcome.mode === "tooComplex",
});

/** Both diffs of concurrent `revision`. Rejects when the read is refused or a text is not well-formed. */
async function loadPairDiffs(docKey: string, revision: string): Promise<{ fromStart: PairDiff; against: PairDiff }> {
  const pair = await readConcurrentPair(docKey, revision);
  const diff = new BudgetedDiff();
  try {
    // One after the other: each deadline counts that diff's own work.
    const fromStart = await diff.diff(pair.observedBefore, pair.result, { deadlineMs: PAIR_DEADLINE_MS });
    const against = await diff.diff(pair.linearBefore, pair.result, { deadlineMs: PAIR_DEADLINE_MS });
    return { fromStart: pairDiff(pair.observedBefore, pair.result, fromStart), against: pairDiff(pair.linearBefore, pair.result, against) };
  } finally {
    diff.close();
  }
}

interface PairState {
  readonly identity: string;
  readonly open: boolean;
  readonly load: PairLoad;
}

const closed = (identity: string): PairState => ({ identity, open: false, load: { status: "idle" } });

/** Whether the pair is open, what has loaded, and the toggle. */
export function useConcurrentPair(docKey: string, revision: string): { open: boolean; load: PairLoad; toggle: () => void } {
  const identity = `${docKey}\u0000${revision}`;
  const [state, setState] = useState<PairState>(() => closed(identity));
  const token = useRef(0);
  // Another document or revision starts closed and idle.
  const current = state.identity === identity ? state : closed(identity);
  if (state.identity !== identity) setState(current);
  const { open, load } = current;

  // Leaving an identity (or unmounting) drops the reply of its load.
  useEffect(
    () => () => {
      token.current += 1;
    },
    [identity],
  );

  const toggle = useCallback(() => {
    // Bound to this identity: a write after the row moved on is dropped.
    const setOpen = (value: boolean) => setState((s) => (s.identity === identity ? { ...s, open: value } : s));
    const setLoad = (value: PairLoad) => setState((s) => (s.identity === identity ? { ...s, load: value } : s));
    if (open) {
      token.current += 1;
      setOpen(false);
      if (load.status !== "ready") setLoad({ status: "idle" });
      return;
    }
    setOpen(true);
    if (load.status === "ready") return;
    token.current += 1;
    const mine = token.current;
    setLoad({ status: "loading" });
    loadPairDiffs(docKey, revision).then(
      (diffs) => {
        if (token.current === mine) setLoad({ status: "ready", ...diffs });
      },
      (error: unknown) => {
        journalWarn("concurrent pair read failed:", error);
        if (token.current === mine) setLoad({ status: "failed" });
      },
    );
  }, [open, load.status, docKey, revision, identity]);

  return { open, load, toggle };
}
