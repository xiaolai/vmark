// @vitest-environment node
// Audit 2026-09-03 W-05 / W-06 / W-07 / W-09 — the per-step guard around the
// executor: skip what is already done (ledger, resumed run, the human's own
// step), check the running-time budget before every attempt, fold attempts into
// one step result, and mark completed writes in the ledger.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeGuardedExecutor, stepWillBeSkipped } from "./runStepGuard";
import { createRunClock } from "./runClock";
import { __resetRunRegistry, createRun, getRun, markWriteStepDone, writeStepAlreadyDone } from "./runRegistry";
import type { WorkflowStep } from "@/lib/browser/workflow/types";
import type { StepOutcome } from "@/lib/browser/workflow/safety";
import { WorkflowPause } from "@/lib/browser/workflow/engine";

const TAB = "tab-1";
const LEDGER = "src+inputs";

const step = (index: number, kind: WorkflowStep["kind"] = "action"): WorkflowStep => ({ index, kind, text: `s${index}`, line: index });
const ok = (): StepOutcome => ({ outcome: "success", postconditionMet: true });

function setup(over: Partial<Parameters<typeof makeGuardedExecutor>[0]> = {}) {
  const run = createRun({ tabId: TAB, sourceHash: "h", inputsHash: "i", stepCount: 5, firstStep: "step-1" });
  const executor = vi.fn<(s: WorkflowStep, i: number) => Promise<StepOutcome>>(async () => ok());
  const guarded = makeGuardedExecutor({
    runId: run.runId,
    tabId: TAB,
    ledgerId: LEDGER,
    allowRepeat: false,
    clock: createRunClock(120_000),
    inherited: new Set(),
    humanDone: null,
    executor,
    ...over,
  });
  return { run, executor, guarded };
}

beforeEach(() => __resetRunRegistry());

describe("makeGuardedExecutor — skips", () => {
  it("skips a write already in the ledger as already-completed, without running it", async () => {
    markWriteStepDone(TAB, LEDGER, "step-2");
    const { run, executor, guarded } = setup();
    const out = await guarded(step(2), 1);
    expect(out).toEqual({ outcome: "success", postconditionMet: true });
    expect(executor).not.toHaveBeenCalled();
    expect(getRun(run.runId)!.stepResults).toEqual([{ index: 2, status: "skipped", attempts: 0, reason: "already-completed" }]);
    expect(getRun(run.runId)!.skippedSteps).toBe(1);
    expect(getRun(run.runId)!.completedSteps).toBe(0);
  });

  it("runs a ledgered write anyway under allowRepeat", async () => {
    markWriteStepDone(TAB, LEDGER, "step-2");
    const { executor, guarded } = setup({ allowRepeat: true });
    await guarded(step(2), 1);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("a read is never ledgered, so it always re-runs", async () => {
    markWriteStepDone(TAB, LEDGER, "step-1");
    const { executor, guarded } = setup();
    await guarded(step(1, "extract"), 0);
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("skips steps inherited from a resumed run, and the paused-at step the human did (W-05)", async () => {
    const { run, executor, guarded } = setup({ inherited: new Set([1, 2]), humanDone: 3 });
    await guarded(step(1), 0);
    await guarded(step(2, "extract"), 1);
    await guarded(step(3, "confirm"), 2);
    expect(executor).not.toHaveBeenCalled();
    expect(getRun(run.runId)!.stepResults.map((s) => [s.index, s.status, s.reason])).toEqual([
      [1, "skipped", "already-completed"],
      [2, "skipped", "already-completed"],
      [3, "skipped", "done-by-human"],
    ]);
  });

  it("stepWillBeSkipped mirrors the guard's decision (used for firstStep)", () => {
    markWriteStepDone(TAB, LEDGER, "step-4");
    const decide = (s: WorkflowStep) =>
      stepWillBeSkipped(s, { tabId: TAB, ledgerId: LEDGER, allowRepeat: false, inherited: new Set([1]), humanDone: 2 });
    expect(decide(step(1))).toBe(true);
    expect(decide(step(2, "confirm"))).toBe(true);
    expect(decide(step(3))).toBe(false);
    expect(decide(step(4))).toBe(true);
    expect(decide(step(4, "extract"))).toBe(false);
  });
});

describe("makeGuardedExecutor — recording and the ledger", () => {
  it("records one entry per step with attempts folded, and ledgers a successful write", async () => {
    const { run, executor, guarded } = setup();
    executor.mockResolvedValueOnce({ outcome: "failed", postconditionMet: false, reason: "obscured" });
    await guarded(step(1), 0);
    await guarded(step(1), 0);
    expect(getRun(run.runId)!.stepResults).toEqual([{ index: 1, status: "success", attempts: 2 }]);
    expect(writeStepAlreadyDone(TAB, LEDGER, "step-1")).toBe(true);
  });

  it("keeps the failure reason and does not ledger a failed write", async () => {
    const { run, executor, guarded } = setup();
    executor.mockResolvedValue({ outcome: "failed", reason: "disabled" });
    await guarded(step(1), 0);
    expect(getRun(run.runId)!.stepResults[0]).toEqual({ index: 1, status: "failed", attempts: 1, reason: "disabled" });
    expect(writeStepAlreadyDone(TAB, LEDGER, "step-1")).toBe(false);
  });

  it("a success the engine will not treat as done is recorded as unknown, and not ledgered (#134)", async () => {
    const { run, executor, guarded } = setup();
    executor.mockResolvedValue({ outcome: "success", postconditionMet: false });
    await guarded(step(1), 0).catch(() => undefined);
    expect(getRun(run.runId)!.stepResults[0]).toMatchObject({ index: 1, status: "unknown" });
    expect(writeStepAlreadyDone(TAB, LEDGER, "step-1")).toBe(false);
  });

  it("keeps step data (an extract summary) on the entry", async () => {
    const { run, executor, guarded } = setup();
    executor.mockResolvedValue({ outcome: "success", data: { title: "T", textLength: 9, truncated: false } });
    await guarded(step(1, "extract"), 0);
    expect(getRun(run.runId)!.stepResults[0].data).toEqual({ title: "T", textLength: 9, truncated: false });
  });

  it("a thrown executor is recorded as unknown with its message, then rethrown", async () => {
    const { run, executor, guarded } = setup();
    executor.mockRejectedValue(new WorkflowPause("denied", "the user denied it"));
    await expect(guarded(step(1), 0)).rejects.toMatchObject({ reasonCode: "denied" });
    expect(getRun(run.runId)!.stepResults[0]).toEqual({ index: 1, status: "unknown", attempts: 1, reason: "the user denied it" });
    expect(writeStepAlreadyDone(TAB, LEDGER, "step-1")).toBe(false);
  });
});

describe("makeGuardedExecutor — the running-time budget (W-06)", () => {
  it("pauses as deadline BEFORE the attempt once the budget is spent", async () => {
    let t = 0;
    const clock = createRunClock(1_000, () => t);
    const { executor, guarded } = setup({ clock });
    await guarded(step(1), 0);
    t = 1_000;
    await expect(guarded(step(2), 1)).rejects.toMatchObject({ reasonCode: "deadline" });
    expect(executor).toHaveBeenCalledTimes(1);
  });

  it("time spent while the clock is paused (a prompt open) does not count", async () => {
    let t = 0;
    const clock = createRunClock(1_000, () => t);
    const { executor, guarded } = setup({ clock });
    clock.pause();
    t = 500_000;
    clock.resume();
    await guarded(step(1), 0);
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
