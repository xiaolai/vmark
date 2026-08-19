// @vitest-environment jsdom
// WI-NB6.1 / P-1 — the workflow run executor: maps each step onto the
// approval-gated act path, re-deciding authorization PER ATTEMPT (a one-shot
// spent on step N can never authorize step N+1). Non-executable steps (goal,
// confirm, api, unparseable action) throw, which the engine turns into a pause.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const mintOneShotConfirmed = vi.fn();
vi.mock("@/services/browser/grantSync", () => ({
  mintOneShotConfirmed: (...a: unknown[]) => mintOneShotConfirmed(...a),
}));

import { makeRunExecutor } from "./runExecutor";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import type { WorkflowStep } from "@/lib/browser/workflow/types";

const URL = "https://blog.example.com/post";
const TAB = "tab-1";

function step(kind: WorkflowStep["kind"], text: string, index = 1): WorkflowStep {
  return { kind, text, index, line: index };
}

function ctx(over: Partial<Parameters<typeof makeRunExecutor>[0]> = {}) {
  return {
    tabId: TAB,
    runId: "run-1",
    inputs: {},
    resolveTab: () => ({ url: URL, generation: 3 }),
    deadlineAt: Number.MAX_SAFE_INTEGER,
    ...over,
  };
}

beforeEach(() => {
  invoke.mockReset();
  mintOneShotConfirmed.mockReset().mockResolvedValue(true);
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
});

describe("extract steps", () => {
  it("run as a read and succeed without any approval", async () => {
    invoke.mockResolvedValue(JSON.stringify({ html: "<html><body><p>hi there friend</p></body></html>", truncated: false }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("extract", "the article body"), 0);
    expect(out.outcome).toBe("success");
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

  it("maps an obscured click to failed + postconditionMet:false (retryable)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: false, reason: "obscured", by: "div.x" }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false });
  });

  it("maps a not-found click to failed + postconditionMet:false", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Ghost" (button)'), 0);
    expect(out.outcome).toBe("failed");
  });

  it("substitutes an {input} into a type value", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, typed: true }));
    const exec = makeRunExecutor(ctx({ inputs: { title: "Hello World" } }));
    await exec(step("action", 'type {title} into "Title" (textbox)'), 0);
    const evalCall = invoke.mock.calls.find((c) => c[0] === "browser_eval")?.[1] as { script: string };
    expect(evalCall.script).toContain("Hello World");
  });

  it("throws (→ pause) when an {input} is not supplied", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["type"]);
    const exec = makeRunExecutor(ctx({ inputs: {} }));
    await expect(exec(step("action", 'type {missing} into "Title"'), 0)).rejects.toThrow(/input/i);
  });
});

describe("action steps — approval required (P-1)", () => {
  it("consumes a one-shot per attempt and awaits the Rust mint before acting", async () => {
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", { role: "button", name: "Pay" }, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once"); // user granted once
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Pay" (button)'), 0);
    expect(mintOneShotConfirmed).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBe("success");
  });

  it("pauses (throws) at the deadline when no authorization arrives", async () => {
    const exec = makeRunExecutor(ctx({ deadlineAt: 0 })); // already past
    await expect(exec(step("action", 'click "Pay" (button)'), 0)).rejects.toThrow(/approval/i);
    // it raised a run-scoped prompt for the human to act on
    expect(useBrowserApprovalStore.getState().pending.some((p) => p.runId === "run-1")).toBe(true);
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
});

// WI-NB6.4 / P-3 — self-heal: a not-found click retries against a same-role
// locator whose name is close, re-entering the approval path so the healed
// descriptor gets its own authorization (a one-shot for the old name cannot
// match). An obscured/disabled result is NOT healed (page state, not drift).
describe("self-heal (WI-NB6.4 / P-3)", () => {
  it("retries a not-found click against a fuzzy-matched same-role locator", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockImplementation((cmd: string, args?: { script?: string; operation?: string; name?: string }) => {
      if (cmd === "browser_eval" && args?.operation === "read") {
        return Promise.resolve(JSON.stringify([{ role: "button", name: "Publish now", ref: "e1" }]));
      }
      if (cmd === "browser_eval" && args?.name === "Publish now") {
        return Promise.resolve(JSON.stringify({ found: true, clicked: true }));
      }
      return Promise.resolve(JSON.stringify({ found: false, clicked: false, matchedTotal: 0, matchedVisible: 0 }));
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out.outcome).toBe("success");
  });

  it("does not heal an obscured click (page state, not a drifted locator)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    const snapshot = vi.fn();
    invoke.mockImplementation((cmd: string, args?: { operation?: string }) => {
      if (args?.operation === "read") {
        snapshot();
        return Promise.resolve(JSON.stringify([]));
      }
      return Promise.resolve(JSON.stringify({ found: true, clicked: false, reason: "obscured", by: "div.x" }));
    });
    const exec = makeRunExecutor(ctx());
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out).toEqual({ outcome: "failed", postconditionMet: false });
    expect(snapshot).not.toHaveBeenCalled(); // heal never attempted
  });

  it("respects selfHeal:false", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: false, clicked: false }));
    const exec = makeRunExecutor(ctx({ selfHeal: false }));
    const out = await exec(step("action", 'click "Publish" (button)'), 0);
    expect(out.outcome).toBe("failed");
    expect(invoke.mock.calls.some((c) => (c[1] as { operation?: string })?.operation === "read")).toBe(false);
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
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));

    const exec = makeRunExecutor(ctx());
    // First Pay click consumes the one-shot and succeeds.
    const first = await exec(step("action", 'click "Pay" (button)'), 0);
    expect(first.outcome).toBe("success");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);

    // A SECOND Pay click has no authorization: with a past deadline it must
    // raise a fresh prompt and pause, never silently re-use the spent one-shot.
    const exec2 = makeRunExecutor(ctx({ deadlineAt: 0 }));
    await expect(exec2(step("action", 'click "Pay" (button)'), 1)).rejects.toThrow(/approval/i);
  });

  it("a granted standing origin authorizes every attempt (retry re-decides, still allowed)", async () => {
    useBrowserApprovalStore.getState().grant("https://blog.example.com", ["click"]);
    invoke.mockResolvedValue(JSON.stringify({ found: true, clicked: true }));
    const exec = makeRunExecutor(ctx());
    // Two separate invocations (as the engine would on retry) both succeed with
    // no prompt — a standing grant is what carries, not a one-shot.
    expect((await exec(step("action", 'click "A" (button)'), 0)).outcome).toBe("success");
    expect((await exec(step("action", 'click "A" (button)'), 1)).outcome).toBe("success");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });
});
