// WI-AL2.1a — The budgeted diff's own main-thread checks are inside its deadline: the inputs' well-formedness scan and a worker result's canonical check read the clock every CHECK_CHUNK units, and a check still running at the settle point stops and settles the ONE coarse change instead of scanning on or accepting the result as exact. Edge cases: a lone surrogate the scan never reached (coarse, not INVALID_TEXT), equal texts whose scan was cut short (coarse, not exact), one inside the first chunk (still INVALID_TEXT), a check that crosses the settle point on a short text, a surrogate pair straddling or starting a chunk boundary, a lone surrogate at a boundary, no budget at all
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetedDiff } from "../budgetedDiff";
import { COARSE_RESERVE_MS, DIFF_DEADLINE_MS, type DiffOutcome } from "../diffBudget";
import { CHECK_CHUNK, InvalidTextError, OverBudget, assertCanonical, assertWellFormed } from "../textChanges";
import { fakeFactory, type FakeFactory } from "./fakeDiffWorker";

const SETTLE_AT = DIFF_DEADLINE_MS - COARSE_RESERVE_MS;
let f: FakeFactory;
let lib: BudgetedDiff;
/** Added to the fake clock from the call after the next one on, once armed. */
let jump: { armed: boolean; reads: number } = { armed: false, reads: 0 };

beforeEach(() => {
  vi.useFakeTimers();
  f = fakeFactory();
  jump = { armed: false, reads: 0 };
  const now = () => Date.now() + (jump.armed && jump.reads++ > 0 ? SETTLE_AT : 0);
  lib = new BudgetedDiff({ factory: f.factory, warn: vi.fn(), now });
});
afterEach(() => {
  lib.close();
  vi.useRealTimers();
});

function track(p: Promise<DiffOutcome>) {
  const box: { value: DiffOutcome | null; error: unknown } = { value: null, error: null };
  p.then((v) => (box.value = v), (e: unknown) => (box.error = e));
  return box;
}

describe("the input scan is inside the deadline", () => {
  it("stops at the settle point and settles coarse, before a lone surrogate it never reached", async () => {
    jump.armed = true;
    const out = track(lib.diff(`${"x".repeat(3 * CHECK_CHUNK)}\uD800`, "y"));
    await vi.advanceTimersByTimeAsync(0);
    expect(out.error).toBeNull();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: false });
    expect(f.workers.flatMap((w) => w.posted)).toHaveLength(0);
  });

  it("settles equal texts coarse too when the scan was cut short: their exact answer is unproven", async () => {
    jump.armed = true;
    const text = `${"x".repeat(3 * CHECK_CHUNK)}\uD800`;
    const out = track(lib.diff(text, text));
    await vi.advanceTimersByTimeAsync(0);
    expect(out.error).toBeNull();
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: false });
  });

  it("still refuses a lone surrogate inside the first chunk as INVALID_TEXT", async () => {
    jump.armed = true;
    await expect(lib.diff(`a\uDC00${"x".repeat(3 * CHECK_CHUNK)}`, "y")).rejects.toBeInstanceOf(InvalidTextError);
  });
});

describe("a worker result's check is inside the deadline", () => {
  it.each([
    ["a short text", "ab12cd", "aX12Yd"],
    ["a text longer than one chunk", `${"q".repeat(2 * CHECK_CHUNK)}ab`, `${"q".repeat(2 * CHECK_CHUNK)}aX`],
  ])("settles coarse, not exact, when the check of %s crosses the settle point", async (_name, a, b) => {
    const out = track(lib.diff(a, b));
    f.workers[0].ready();
    await vi.advanceTimersByTimeAsync(0);
    jump.armed = true;
    f.workers[0].answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(out.value).toMatchObject({ mode: "tooComplex", reason: "deadline", dispatched: true });
    expect(f.workers[0].terminated).toBe(false);
    expect(lib.status().timeouts).toBe(1);
  });
});

describe("the chunked checks", () => {
  const never = { until: Number.POSITIVE_INFINITY, now: () => 0 };
  const pad = "x".repeat(CHECK_CHUNK - 1);

  it.each([
    ["a pair straddling a chunk boundary", `${pad}😀z`],
    ["a pair starting a chunk", `${pad}x😀`],
  ])("accept %s", (_name, text) => {
    expect(() => assertWellFormed(text, text, never)).not.toThrow();
    expect(() => assertWellFormed(text, text)).not.toThrow();
  });

  it.each([
    ["a lone high surrogate ending a chunk", `${pad}\uD83Dz`],
    ["a lone low surrogate starting a chunk", `${pad}x\uDE00`],
  ])("refuse %s", (_name, text) => {
    expect(() => assertWellFormed(text, "ok", never)).toThrow(InvalidTextError);
  });

  it("throws OverBudget from a canonical check that reaches its budget, and passes without one", () => {
    const changes = [{ fromA: 1, toA: 2, fromB: 1, toB: 2 }];
    expect(() => assertCanonical("abc", "aXc", changes, { until: 0, now: () => 0 })).toThrow(OverBudget);
    expect(() => assertCanonical("abc", "aXc", changes)).not.toThrow();
  });

  it("still refuses a result whose unchanged text differs, chunk by chunk", () => {
    const a = `${pad}ab${pad}`;
    const b = `${pad}aX${pad.slice(1)}y`;
    expect(() => assertCanonical(a, b, [{ fromA: CHECK_CHUNK, toA: CHECK_CHUNK + 1, fromB: CHECK_CHUNK, toB: CHECK_CHUNK + 1 }], never)).toThrow(/reconstruct/);
  });
});
