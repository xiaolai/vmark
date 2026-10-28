// @vitest-environment node
// The journaled-mutation coordinator's provenance settlement and effects hook.
// The apply forks the provenance window onto the applied text, recorded at
// the committed revision or invalidated; an abort records the freeze at its
// baseline; the caller's recheck runs only after an awaited payload. The
// effects hook runs strictly between the apply and the commit, its result
// reaches the commit call, and a hook that throws or never settles still
// commits and is answered applied-with-error, never a silent skip.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { agentJournalFake as fake } from "@/test/agentJournalFake";
import type { CommitExtras } from "../journalClient";
import { journalBasis } from "../documentIdentity";
import { registerUnsavedProvenanceSource } from "../unsavedProvenance";
import { EFFECTS_DEADLINE_MS, runJournaledMutation } from "../journaledMutation";
import { KEY, TAB, content, mutation, ops, resetMutationFixture } from "./journaledMutationFixture";

beforeEach(resetMutationFixture);

afterEach(() => {
  vi.useRealTimers();
});

describe("runJournaledMutation — provenance", () => {
  function source(payloadDelay?: () => void) {
    const freeze = { touched: true, capture: { view: "v", session: "s", seq: "1" }, inTurn: <T>(send: () => Promise<T>) => send(), payload: vi.fn(async () => (payloadDelay?.(), null)), recorded: vi.fn(), invalidate: vi.fn(), release: vi.fn() };
    const forks: Array<{ text: string; recorded: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> }> = [];
    registerUnsavedProvenanceSource(TAB, {
      freeze: () => freeze,
      fork: (text) => {
        const f = { text, recorded: vi.fn(), invalidate: vi.fn() };
        forks.push(f);
        return f;
      },
    });
    return { freeze, forks };
  }

  it("forks onto the applied text and records the fork at the committed revision", async () => {
    const { freeze, forks } = source();
    await runJournaledMutation(mutation());
    expect(forks.map((f) => f.text)).toEqual(["after"]);
    expect(forks[0].recorded).toHaveBeenCalledWith(fake.doc(KEY).head);
    expect(freeze.invalidate).toHaveBeenCalled();
  });

  it("a commit the journal refuses leaves the fork unrecorded: it is invalidated", async () => {
    const { forks } = source();
    fake.refuseNextCommits();
    expect(await runJournaledMutation(mutation())).toMatchObject({ status: "applied", durable: false });
    expect(forks[0].recorded).not.toHaveBeenCalled();
    expect(forks[0].invalidate).toHaveBeenCalled();
  });

  it("an abort records the freeze at the baseline its prepare recorded", async () => {
    const { freeze, forks } = source();
    await runJournaledMutation(mutation({ verify: () => "selection" }));
    expect(freeze.recorded).toHaveBeenCalledWith(fake.doc(KEY).head);
    expect(forks).toEqual([]);
  });

  it("the recheck runs after the provenance payload is awaited, and its reason aborts before any prepare", async () => {
    const order: string[] = [];
    source(() => order.push("payload"));
    const out = await runJournaledMutation(
      mutation({
        recheck: () => {
          order.push("recheck");
          return "edited";
        },
      }),
    );
    expect(out).toEqual({ status: "aborted", reason: "edited" });
    expect(order).toEqual(["payload", "recheck"]);
    expect(ops()).toEqual([]);
  });

  it("without a provenance source there is no await to recheck", async () => {
    const recheck = vi.fn(() => "edited" as const);
    expect(await runJournaledMutation(mutation({ recheck }))).toMatchObject({ status: "applied" });
    expect(recheck).not.toHaveBeenCalled();
  });
});

describe("runJournaledMutation — the effects hook", () => {
  it("runs strictly after the apply and before the commit, and its result reaches the commit call", async () => {
    const seen: Array<{ buffer: string | undefined; ops: string[] }> = [];
    const extras: CommitExtras = { opaque: { hunks: 1 } };
    const effects = vi.fn(async (_pre: string, _post: string) => {
      seen.push({ buffer: content(), ops: ops() });
      return extras;
    });
    const out = await runJournaledMutation(mutation({ effects }));
    expect(out).toMatchObject({ status: "applied", durable: true });
    expect(effects).toHaveBeenCalledWith("before", "after");
    // Applied (the buffer holds the postimage), not yet committed.
    expect(seen).toEqual([{ buffer: "after", ops: ["prepare"] }]);
    expect(fake.commitControlledWrite).toHaveBeenCalledTimes(1);
    expect(fake.commitControlledWrite.mock.calls[0]).toEqual([expect.any(String), "after", extras]);
  });

  it("absent, the commit carries no extras", async () => {
    await runJournaledMutation(mutation());
    expect(fake.commitControlledWrite.mock.calls[0][2]).toBeUndefined();
  });

  it.each([
    ["a verify mismatch", { verify: () => "edited" as const }],
    ["a refused apply", { apply: () => ({ refused: "applyRefused" as const }) }],
  ])("does not run after %s", async (_label, overrides) => {
    const effects = vi.fn(async () => ({}));
    await runJournaledMutation(mutation({ ...overrides, effects }));
    expect(effects).not.toHaveBeenCalled();
  });

  it("a hook that throws still commits the applied text and is answered applied with error", async () => {
    const boom = new Error("diff failed");
    const out = await runJournaledMutation(mutation({ effects: () => Promise.reject(boom) }));
    expect(out).toEqual({ status: "appliedWithError", error: boom, durable: true });
    expect(ops()).toEqual(["prepare", "commit"]);
    expect(fake.doc(KEY).text).toBe("after");
    expect(fake.commitControlledWrite.mock.calls[0][2]).toBeUndefined();
    expect(journalBasis(TAB, KEY)).toBe(fake.doc(KEY).head);
  });

  it("a hook that throws synchronously is handled the same way", async () => {
    const out = await runJournaledMutation(
      mutation({
        effects: () => {
          throw new Error("sync failure");
        },
      }),
    );
    expect(out).toMatchObject({ status: "appliedWithError", durable: true });
    expect(ops()).toEqual(["prepare", "commit"]);
  });

  it("a hook that never settles is cut off at the deadline: committed, answered applied with error", async () => {
    // Timers only: the prepare's payload digest is real async work the clock must not outrun.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const pending = runJournaledMutation(mutation({ effects: () => new Promise<CommitExtras>(() => {}) }));
    for (let i = 0; i < 1000 && content() !== "after"; i += 1) await new Promise((r) => setImmediate(r));
    expect(content()).toBe("after");
    await vi.advanceTimersByTimeAsync(EFFECTS_DEADLINE_MS - 1);
    expect(ops()).toEqual(["prepare"]);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(out).toMatchObject({ status: "appliedWithError", durable: true });
    expect(out.status === "appliedWithError" && String(out.error)).toContain(`${EFFECTS_DEADLINE_MS} ms`);
    expect(ops()).toEqual(["prepare", "commit"]);
    expect(fake.doc(KEY).text).toBe("after");
  });

  it("a hook failure with a commit that also fails is applied with error, not durable", async () => {
    fake.failNextCommits();
    const out = await runJournaledMutation(mutation({ effects: () => Promise.reject(new Error("diff failed")) }));
    expect(out).toMatchObject({ status: "appliedWithError", durable: false });
  });
});
