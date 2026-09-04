// @vitest-environment jsdom
// WI-NB6.1 / P-1 — the workflow run executor: maps each step onto the
// approval-gated act path, re-deciding authorization PER ATTEMPT (a one-shot
// spent on step N can never authorize step N+1). Non-executable steps (goal,
// confirm, api, unparseable action) throw, which the engine turns into a pause.
// Audit 2026-09-03: W3 (no heal on a ledgered step), W9 (extract data, type
// script binding), W10 (role-less locators resolve their role from a snapshot).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const mintOneShotConfirmed = vi.fn();
vi.mock("@/services/browser/grantSync", () => ({
  mintOneShotConfirmed: (...a: unknown[]) => mintOneShotConfirmed(...a),
}));

import { makeRunExecutor, type RunExecutorContext } from "./runExecutor";
import { createRunClock } from "./runClock";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { WorkflowStep } from "@/lib/browser/workflow/types";

const URL = "https://blog.example.com/post";
const TAB = "tab-1";

function step(kind: WorkflowStep["kind"], text: string, index = 1): WorkflowStep {
  return { kind, text, index, line: index };
}

function ctx(over: Partial<RunExecutorContext> = {}): RunExecutorContext {
  return {
    tabId: TAB,
    runId: "run-1",
    inputs: {},
    resolveTab: () => ({ url: URL, generation: 3 }),
    clock: createRunClock(120_000),
    signal: new AbortController().signal,
    leaseEpoch: 0,
    pollMs: 1,
    ...over,
  };
}

/** A snapshot eval result in the current `{nodes, truncated, unreachable}` shape. */
const snapshotOf = (nodes: Array<[string, string]>, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ nodes: nodes.map(([role, name], i) => ({ role, name, ref: `e${i}` })), truncated: false, unreachable: 0, ...extra });

/** Route `browser_eval` calls: reads answer with `snapshot`, acts with `act(args)`. */
function routeEval(snapshot: string, act: (args: { role?: string; name?: string; script?: string }) => unknown) {
  invoke.mockImplementation((cmd: string, args?: { operation?: string; role?: string; name?: string; script?: string }) => {
    if (cmd !== "browser_eval") return Promise.resolve({});
    if (args?.operation === "read") return Promise.resolve(snapshot);
    return Promise.resolve(JSON.stringify(act(args ?? {})));
  });
}

beforeEach(() => {
  invoke.mockReset();
  mintOneShotConfirmed.mockReset().mockResolvedValue(true);
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
});

describe("extract steps", () => {
  it("run as a read, succeed without any approval, and keep the reader summary as step data (W9)", async () => {
    invoke.mockResolvedValue(JSON.stringify({ html: "<html><head><title>My Post</title></head><body><article><h1>My Post</h1><p>hi there friend, this is the body</p></article></body></html>", truncated: false }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("extract", "the article body"), 0);
    expect(out.outcome).toBe("success");
    expect(out.data).toMatchObject({ title: "My Post", truncated: false });
    expect(typeof out.data?.textLength).toBe("number");
    expect(invoke).toHaveBeenCalledWith("browser_eval", expect.objectContaining({ operation: "read" }));
  });
});

describe("action steps — granted origin", () => {
  it("a click on a granted origin runs with no one-shot and maps clicked→success", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "success", postconditionMet: true });
    expect(mintOneShotConfirmed).not.toHaveBeenCalled();
  });

  it.each([
    [{ found: true, clicked: true, extra: 1 }, "malformed-act-result"],
    [{ found: true, clicked: true, typed: true }, "malformed-act-result"],
    [{ found: true, clicked: false, matchedTotal: -1 }, "malformed-act-result"],
    [{ found: true, clicked: false, candidates: [{ ref: 1 }] }, "malformed-act-result"],
    [{ found: true, clicked: false, matchedTotal: 1, matchedVisible: 2 }, "contradictory-act-result"],
    [{ found: true, clicked: true, by: "div.overlay" }, "contradictory-act-result"],
    [{ found: true, clicked: true, candidates: [] }, "contradictory-act-result"],
    [{ found: false, clicked: true, matchedTotal: 0, matchedVisible: 0 }, "contradictory-act-result"],
  ])("the whole act result is schema-checked: %j → %s (#193)", async (result, reason) => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify(result));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toMatchObject({ outcome: "unknown", reason });
  });

  it("a contradictory {found:false, clicked:true} never triggers a heal (a second write) (#193)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const snapshot = vi.fn(() => snapshotOf([["button", "Publish!"]]));
    invoke.mockImplementation((cmd: string, args?: { operation?: string }) => {
      if (cmd !== "browser_eval") return Promise.resolve({});
      if (args?.operation === "read") return Promise.resolve(snapshot());
      return Promise.resolve(JSON.stringify({ found: false, clicked: true, matchedTotal: 0, matchedVisible: 0 }));
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toMatchObject({ outcome: "unknown", reason: "contradictory-act-result" });
    expect(snapshot).not.toHaveBeenCalled(); // no heal attempted
    expect(invoke.mock.calls.filter(([, a]) => (a as { operation?: string })?.operation === "click")).toHaveLength(1);
  });

  it("a success carrying a failure reason is contradictory → unknown, never success (#193)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, reason: "disabled", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toMatchObject({ outcome: "unknown", reason: "contradictory-act-result" });
  });

  it("a null act result is unknown (malformed), never a success or a retryable miss (#193)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue("null");
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toMatchObject({ outcome: "unknown", reason: "malformed-act-result" });
  });

  it("maps an obscured click to failed + postconditionMet:false (retryable) with the reason", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: false, reason: "obscured", by: "div.x", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false, reason: "obscured" });
  });

  it("maps a disabled target to a stop-and-ask failure", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: false, reason: "disabled", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", reason: "disabled" });
  });

  it("maps a not-found click to failed + postconditionMet:false", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([]), () => ({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false, reason: "not-found" });
  });

  it("a count-less {found:false, clicked:false} is malformed → unknown, never a healable not-found (#193 round 5)", async () => {
    // The act script emits matchedTotal/matchedVisible on every miss; a miss without
    // them is not the script's verdict, so it must not qualify for a heal retry.
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    let evals = 0;
    routeEval(snapshotOf([]), () => {
      evals += 1;
      return { found: false, clicked: false };
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out).toEqual({ outcome: "unknown", reason: "malformed-act-result" });
    expect(evals).toBe(1);
  });

  it("a miss that reports matches ({found:false, matchedTotal:1, matchedVisible:1}) is contradictory → unknown, never healed (#193 round 6)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    let evals = 0;
    routeEval(snapshotOf([]), () => {
      evals += 1;
      return { found: false, clicked: false, matchedTotal: 1, matchedVisible: 1 };
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out).toEqual({ outcome: "unknown", reason: "contradictory-act-result" });
    expect(evals).toBe(1);
  });

  it.each([
    [{ found: true, clicked: false, reason: "not-found" }, "a refusal with a reason the producer never emits"],
    [{ found: true, clicked: false, matchedTotal: 1, matchedVisible: 1 }, "a refusal with no reason at all"],
    [{ found: true, clicked: false, reason: "hidden", candidates: [{ ref: "r1", text: "x" }], matchedTotal: 1, matchedVisible: 0 }, "candidates on a non-ambiguous refusal"],
    [{ found: true, clicked: false, reason: "hidden", by: "overlay", matchedTotal: 1, matchedVisible: 0 }, "`by` on a non-obscured refusal"],
    [{ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0, reason: "hidden" }, "a miss carrying a reason"],
    [{ found: true, clicked: false, reason: "hidden" }, "a count-less refusal (every producer path carries counts)"],
    [{ found: true, clicked: true }, "a count-less success"],
    [{ found: true, clicked: true, matchedTotal: 1, matchedVisible: 0 }, "a success with no visible match"],
    [{ found: true, clicked: false, reason: "ambiguous", candidates: [{ ref: "r1", text: "x" }], matchedTotal: 2, matchedVisible: 1 }, "ambiguity with one visible match"],
    [{ found: true, clicked: false, reason: "hidden", matchedTotal: 0, matchedVisible: 0 }, "found:true with no match"],
    [{ found: true, clicked: true, matchedTotal: 2, matchedVisible: 2 }, "a success with two visible matches (that is an ambiguity)"],
    [{ found: true, clicked: false, reason: "hidden", matchedTotal: 1, matchedVisible: 1 }, "hidden with a visible match"],
    [{ found: true, clicked: false, reason: "obscured", by: "div.x", matchedTotal: 2, matchedVisible: 2 }, "obscured judged on two visible matches"],
    [{ found: true, clicked: false, reason: "readonly", matchedTotal: 1, matchedVisible: 0 }, "readonly with no visible match"],
    [{ found: true, clicked: true, detail: "editor-handled", matchedTotal: 1, matchedVisible: 1 }, "a click success carrying a detail (only a typed success may)"],
    [{ found: true, clicked: false, reason: "hidden", detail: "inert", matchedTotal: 1, matchedVisible: 0 }, "a detail on a reason that never carries one"],
    [{ found: true, clicked: false, reason: "disabled", detail: "elsewhere", matchedTotal: 1, matchedVisible: 1 }, "a detail the producer never writes"],
    [{ found: true, clicked: false, reason: "obscured", matchedTotal: 1, matchedVisible: 1 }, "obscured without the occluder (`by`)"],
    [{ found: true, clicked: false, reason: "ambiguous", matchedTotal: 2, matchedVisible: 2 }, "an ambiguity without its candidates"],
    [{ found: true, clicked: false, reason: "ambiguous", candidates: [{ ref: "r1", text: "a" }], matchedTotal: 2, matchedVisible: 2 }, "an ambiguity with fewer candidates than visible matches"],
    [{ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0, constructor: "x" }, "a prototype-named key (\"constructor\") — must not resolve through Object.prototype"],
    [{ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0, toString: "x" }, "a prototype-named key (\"toString\")"],
    [{ found: true, clicked: false, reason: "constructor", matchedTotal: 1, matchedVisible: 1 }, "a prototype-named reason"],
    [{ found: true, clicked: false, reason: "hasOwnProperty", matchedTotal: 1, matchedVisible: 1 }, "another prototype-named reason"],
    [{ found: true, clicked: false, reason: "readonly", matchedTotal: 1, matchedVisible: 1 }, "a typing-only reason on a click"],
    [{ found: true, clicked: false, reason: "error", detail: "boom", matchedTotal: 1, matchedVisible: 1 }, "a typing exception reported by a click"],
  ])("a result outside the producer's three shapes is malformed → unknown, never healed (#193 round 8): %j — %s", async (payload, _why) => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    let evals = 0;
    routeEval(snapshotOf([]), () => {
      evals += 1;
      return payload;
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out).toEqual({ outcome: "unknown", reason: "malformed-act-result" });
    expect(evals).toBe(1);
  });

  it("typing-only refusals stay valid on a TYPE step; a typing exception is unknown, not a retryable miss (#193 rounds 14–15)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    routeEval(snapshotOf([]), () => ({ found: true, typed: false, reason: "readonly", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    expect(await exec(step("action", 'type "hello" into "Body" (textbox)'), 0)).toEqual({ outcome: "failed", postconditionMet: false, reason: "readonly" });
    routeEval(snapshotOf([]), () => ({ found: true, typed: false, reason: "error", detail: "setter threw", matchedTotal: 1, matchedVisible: 1 }));
    // An exception may follow a partial mutation: unknown, never a retryable miss.
    expect(await exec(step("action", 'type "hello" into "Body" (textbox)'), 1)).toEqual({ outcome: "unknown", reason: "act-threw" });
    routeEval(snapshotOf([]), () => ({ found: true, typed: false, reason: "error", matchedTotal: 1, matchedVisible: 1 }));
    expect(await exec(step("action", 'type "hello" into "Body" (textbox)'), 2)).toEqual({ outcome: "unknown", reason: "malformed-act-result" });
  });

  it("a real ambiguity — one candidate per visible match — is the stop-and-ask failure (#193 round 12)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([]), () => ({
      found: true, clicked: false, reason: "ambiguous",
      candidates: [{ ref: "r1", text: "Publish" }, { ref: "r2", text: "Publish" }],
      matchedTotal: 2, matchedVisible: 2,
    }));
    const exec = makeRunExecutor(ctx());
    expect(await exec(step("action", 'click "Publish" (button)'), 0)).toEqual({ outcome: "failed", reason: "ambiguous" });
  });

  it("the producer's annotated shapes stay valid: an inert-disabled refusal and an editor-handled typed success (#193 round 11)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click", "type"]);
    routeEval(snapshotOf([]), () => ({ found: true, clicked: false, reason: "disabled", detail: "inert", matchedTotal: 1, matchedVisible: 0 }));
    const exec = makeRunExecutor(ctx());
    expect(await exec(step("action", 'click "Ghost" (button)'), 0)).toEqual({ outcome: "failed", reason: "disabled" });
    routeEval(snapshotOf([]), () => ({ found: true, typed: true, detail: "editor-handled", matchedTotal: 1, matchedVisible: 1 }));
    expect(await exec(step("action", 'type "hello" into "Body" (textbox)'), 1)).toEqual({ outcome: "success", postconditionMet: true });
  });

  it("a hidden refusal WITH its counts is the ordinary failed outcome (#193 round 8)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([]), () => ({ found: true, clicked: false, reason: "hidden", matchedTotal: 1, matchedVisible: 0 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false, reason: "hidden" });
  });

  it("substitutes an {input} into a type value", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, typed: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx({ inputs: { title: "Hello World" } }));
    await exec(step("action", 'type {title} into "Title" (textbox)'), 0);
    const evalCall = invoke.mock.calls.find((c) => c[0] === "browser_eval")?.[1] as { script: string };
    expect(evalCall.script).toContain("Hello World");
  });

  it("throws (→ pause) when an {input} is not supplied — inherited keys do not count (W9)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    const exec = makeRunExecutor(ctx({ inputs: {} }));
    await expect(exec(step("action", 'type {missing} into "Title" (textbox)'), 0)).rejects.toThrow(/input/i);
    await expect(exec(step("action", 'type {constructor} into "Title" (textbox)'), 0)).rejects.toThrow(/input/i);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("action steps — approval required (P-1)", () => {
  it("consumes a one-shot per attempt and awaits the Rust mint before acting", async () => {
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", { role: "button", name: "Pay" }, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once"); // user granted once
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Pay" (button)'), 0);
    expect(mintOneShotConfirmed).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe("success");
  });

  it("a type step binds the BUILT script into its prompt and shows the text (A-05)", async () => {
    const controller = new AbortController();
    const exec = makeRunExecutor(ctx({ signal: controller.signal, inputs: { title: "Hello" } }));
    const run = exec(step("action", 'type {title} into "Title" (textbox)'), 0);
    await new Promise((r) => setTimeout(r, 5));
    const prompt = useBrowserApprovalStore.getState().pending.find((p) => p.runId === "run-1");
    expect(prompt).toMatchObject({ operation: "type", target: { role: "textbox", name: "Title" }, payloadSummary: 'Text: "Hello"' });
    expect(prompt?.script).toContain("Hello");
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(Error);
  });

  it("an already-aborted run raises no prompt and acts on nothing", async () => {
    const controller = new AbortController();
    controller.abort();
    const exec = makeRunExecutor(ctx({ signal: controller.signal }));
    await expect(exec(step("action", 'click "Pay" (button)'), 0)).rejects.toBeInstanceOf(Error);
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("a spent run budget pauses as deadline before any act", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const exec = makeRunExecutor(ctx({ clock: createRunClock(0) }));
    await expect(exec(step("action", 'click "Pay" (button)'), 0)).rejects.toMatchObject({ reasonCode: "deadline" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("non-executable steps pause the run", () => {
  it.each([
    ["goal", "open my creator dashboard"],
    ["confirm", "show me the drafts"],
    ["api", "fetch new comments"],
    ["action", "do something clever"],
  ] as const)("%s throws with a descriptive reason", async (kind, text) => {
    const exec = makeRunExecutor(ctx());
    await expect(exec(step(kind, text), 0)).rejects.toThrow();
  });

  it("a malformed target names the defect instead of acting on an empty name (W12)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const exec = makeRunExecutor(ctx());
    await expect(exec(step("action", 'click ""'), 0)).rejects.toThrow(/malformed-target/);
    expect(invoke).not.toHaveBeenCalled();
  });
});

// WI-NB6.4 / P-3 — self-heal: a not-found click retries against a same-role
// locator whose name is close, re-entering the approval path so the healed
// descriptor gets its own authorization (a one-shot for the old name cannot
// match). An obscured/disabled result is NOT healed (page state, not drift).
describe("self-heal (WI-NB6.4 / P-3)", () => {
  it("retries a not-found click against a fuzzy-matched same-role locator", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    // A healed act is a WRITE, so only a near-identical name qualifies (the
    // permissive prefix floor no longer applies: "Publish" must not heal to
    // "Publish now", which is a different action).
    routeEval(snapshotOf([["button", "Publish!"]]), (args) =>
      args.name === "Publish!" ? { found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 } : { found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 },
    );
    const exec = makeRunExecutor(ctx());
    const run = exec(step("action", 'click "Publish" (button)'), 0);
    // The healed locator is not the one the author wrote: the standing grant does
    // not cover it, so a prompt naming the NEW target is raised and must be approved
    // (round 3, #162). "Once" mints and the healed click proceeds.
    await vi.waitFor(() => {
      const prompt = useBrowserApprovalStore.getState().pending.find((p) => p.target?.name === "Publish!");
      expect(prompt).toBeDefined();
      useBrowserApprovalStore.getState().resolveApproval(prompt!.id, "once");
    });
    const out = await run;
    expect(out).toMatchObject({ outcome: "success", data: { healedFrom: "Publish", healedTo: "Publish!" } });
    expect(mintOneShotConfirmed).toHaveBeenCalledTimes(1);
  });

  it("a healed write is never silently authorized by a standing grant (round 3, #162)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([["button", "Publish!"]]), (args) =>
      args.name === "Publish!" ? { found: true, clicked: true } : { found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 },
    );
    const controller = new AbortController();
    const exec = makeRunExecutor(ctx({ signal: controller.signal }));
    const run = exec(step("action", 'click "Publish" (button)'), 0);
    await vi.waitFor(() => expect(useBrowserApprovalStore.getState().pending.some((p) => p.target?.name === "Publish!")).toBe(true));
    // Nothing was clicked on the healed target while the prompt is open.
    expect(invoke.mock.calls.filter(([, a]) => (a as { name?: string })?.name === "Publish!")).toHaveLength(0);
    controller.abort();
    await expect(run).rejects.toBeDefined();
  });

  it("does not heal an obscured click (page state, not a drifted locator)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const snapshot = vi.fn();
    invoke.mockImplementation((cmd: string, args?: { operation?: string }) => {
      if (args?.operation === "read") {
        snapshot();
        return Promise.resolve(snapshotOf([]));
      }
      return Promise.resolve(JSON.stringify({ found: true, clicked: false, reason: "obscured", by: "div.x", matchedTotal: 1, matchedVisible: 1 }));
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false, reason: "obscured" });
    expect(snapshot).not.toHaveBeenCalled(); // heal never attempted
  });

  it("respects selfHeal:false", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 }));
    const exec = makeRunExecutor(ctx({ selfHeal: false }));
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out.outcome).toBe("failed");
    expect(invoke.mock.calls.some((c) => (c[1] as { operation?: string })?.operation === "read")).toBe(false);
  });

  it("never heals a step whose write is already in the ledger — the post-action page shows the antonym (W3)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const reads = vi.fn();
    invoke.mockImplementation((cmd: string, args?: { operation?: string }) => {
      if (args?.operation === "read") {
        reads();
        return Promise.resolve(snapshotOf([["button", "Publish now"]]));
      }
      return Promise.resolve(JSON.stringify({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 }));
    });
    const exec = makeRunExecutor(ctx({ isWriteLedgered: (index) => index === 1 }));
    const out = await exec(step("action", 'click "Publish" (button)', 1), 0);
    expect(out).toMatchObject({ outcome: "failed", postconditionMet: false });
    expect(reads).not.toHaveBeenCalled();
  });

  it("does not heal onto an antonym (W3): the failed control's inverse is left alone", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const acted: string[] = [];
    routeEval(snapshotOf([["button", "Unpublish"]]), (args) => {
      acted.push(args.name ?? "");
      return { found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 };
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out.outcome).toBe("failed");
    expect(acted).toEqual(["Publish"]);
  });
});

// Audit 2026-09-03 S-02 / W10 — a role-less `click "name"` resolves its role
// from a fresh snapshot before authorising, so the prompt names a real control
// and the act script never receives the unmatchable `role:""`.
describe("role-less locators (W10)", () => {
  it("resolves the single role carrying the name and acts with it", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([["link", "Home"], ["button", "Publish"]]), (args) => ({ found: true, clicked: args.role === "button", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish"'), 0);
    expect(out).toEqual({ outcome: "success", postconditionMet: true });
    const act = invoke.mock.calls.find((c) => (c[1] as { operation?: string }).operation === "click")?.[1] as { role: string };
    expect(act.role).toBe("button");
  });

  it("a type step with no role resolves the field's role the same way", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    routeEval(snapshotOf([["searchbox", "Search"]]), (args) => ({ found: true, typed: args.role === "searchbox", matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'type "cats" into "Search"'), 0);
    expect(out).toEqual({ outcome: "success", postconditionMet: true });
  });

  it("several roles share the name → failed as ambiguous, stop and ask (no coin flip, no act)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([["link", "Publish"], ["button", "Publish"]]), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish"'), 0);
    expect(out.outcome).toBe("failed");
    expect(out.postconditionMet).toBeUndefined();
    expect(out.reason).toMatch(/^ambiguous/);
    expect(invoke.mock.calls.filter((c) => (c[1] as { operation?: string }).operation === "click")).toHaveLength(0);
  });

  it("no node carries the name → the ordinary not-found failure, nothing acted", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([["button", "Other"]]), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish"'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false, reason: "not-found" });
    expect(invoke.mock.calls.filter((c) => (c[1] as { operation?: string }).operation === "click")).toHaveLength(0);
  });

  it("a miss on a truncated or partly unreachable snapshot stops and asks", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(snapshotOf([], { truncated: true }), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    expect(await exec(step("action", 'click "Publish"'), 0)).toEqual({ outcome: "failed", reason: "snapshot-truncated" });
    routeEval(snapshotOf([], { unreachable: 2 }), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    expect(await exec(step("action", 'click "Publish"'), 0)).toEqual({ outcome: "failed", reason: "snapshot-unreachable" });
  });

  it("an unreadable snapshot (eval timeout) is unknown → pause, never an act", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    routeEval(JSON.stringify("<timeout>"), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    await expect(exec(step("action", 'click "Publish"'), 0)).rejects.toThrow(/snapshot/);
  });

  it("the role is resolved BEFORE authorising, so the prompt names the real control", async () => {
    const controller = new AbortController();
    routeEval(snapshotOf([["button", "Publish"]]), () => ({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx({ signal: controller.signal }));
    const run = exec(step("action", 'click "Publish"'), 0);
    await new Promise((r) => setTimeout(r, 5));
    expect(useBrowserApprovalStore.getState().pending.find((p) => p.runId === "run-1")?.target).toEqual({ role: "button", name: "Publish" });
    controller.abort();
    await expect(run).rejects.toBeInstanceOf(Error);
  });
});

// WI-NB6.5 / P-1 — the anti-laundering property, at the executor level: a
// one-shot granted for one act is CONSUMED by that act and cannot authorize
// the next act on the same origin. The engine retries by calling the executor
// again, so this is where "replay must not launder a one-shot into standing
// automation" is enforced.
describe("P-1: one-shot does not carry between acts (WI-NB6.5)", () => {
  it("a one-shot spent on act N leaves act N+1 needing its own authorization", async () => {
    // User granted ONE click on Pay.
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", { role: "button", name: "Pay" }, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once");
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));

    const exec = makeRunExecutor(ctx());
    // First Pay click consumes the one-shot and succeeds.
    const first = await exec(step("action", 'click "Pay" (button)'), 0);
    expect(first.outcome).toBe("success");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);

    // A SECOND Pay click has no authorization: it must raise a fresh prompt and
    // wait, never silently re-use the spent one-shot.
    const controller = new AbortController();
    const exec2 = makeRunExecutor(ctx({ signal: controller.signal }));
    const second = exec2(step("action", 'click "Pay" (button)'), 1);
    await new Promise((r) => setTimeout(r, 5));
    expect(useBrowserApprovalStore.getState().pending.some((p) => p.runId === "run-1")).toBe(true);
    expect(invoke.mock.calls.filter((c) => (c[1] as { operation?: string }).operation === "click")).toHaveLength(1);
    controller.abort();
    await expect(second).rejects.toBeInstanceOf(Error);
  });

  it("a granted standing origin authorizes every attempt (retry re-decides, still allowed)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true, matchedTotal: 1, matchedVisible: 1 }));
    const exec = makeRunExecutor(ctx());
    // Two separate invocations (as the engine would on retry) both succeed with
    // no prompt — a standing grant is what carries, not a one-shot.
    expect((await exec(step("action", 'click "A" (button)'), 0)).outcome).toBe("success");
    expect((await exec(step("action", 'click "A" (button)'), 1)).outcome).toBe("success");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });
});
