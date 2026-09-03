// @vitest-environment node
// Audit 2026-09-03 W-02 — a `navigate to` step AWAITS the navigation ticket it
// gets from the driver, exactly like the one-off `navigate` tool: loaded →
// success (the next step sees the new generation); failed / timeout / superseded
// → failed + postconditionMet:false; an approval-required refusal raises a
// run-tagged prompt on the DESTINATION origin and retries once.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { NAVIGATION_WAIT_MS, runNavigateStep, type NavigateStepContext } from "./runNavigate";
import type { RunClock } from "./runClock";
import { WorkflowPause } from "@/lib/browser/workflow/engine";
import type { BrowserWaitResult } from "@/services/browser/browserEventBroker";

const TAB = "tab-1";
const DEST = "https://shop.example.com/cart?x=1";

function clockWith(remaining: number, expired = false): RunClock {
  return { pause: () => {}, resume: () => {}, elapsed: () => 0, remaining: () => remaining, expired: () => expired, paused: false };
}

function harness(over: Partial<NavigateStepContext> = {}) {
  const controller = new AbortController();
  const authorize = vi.fn(async () => ({ url: DEST, generation: 3 }));
  const waitForNavigation = vi.fn<(tabId: string, navigationId: string, timeoutMs: number) => Promise<BrowserWaitResult>>(async () => ({
    kind: "loaded",
    tabId: TAB,
    navigationId: "nav-1",
    generation: 4,
    url: DEST,
    title: "Cart",
  }));
  const onNavigated = vi.fn();
  const ctx: NavigateStepContext = {
    tabId: TAB,
    signal: controller.signal,
    clock: clockWith(1e9),
    authorize,
    waitForNavigation,
    onNavigated,
    ...over,
  };
  return { ctx, controller, authorize, waitForNavigation, onNavigated };
}

const approvalRequired = () => ({ code: "approval-required", message: "navigate needs approval" });

beforeEach(() => {
  invoke.mockReset().mockResolvedValue({ tabId: TAB, navigationId: "nav-1" });
});

describe("runNavigateStep — awaits the ticket (W-02)", () => {
  it("resolves success only once the navigation LOADED, and reports the new page", async () => {
    const { ctx, waitForNavigation, onNavigated } = harness();
    const out = await runNavigateStep(ctx, DEST);
    expect(invoke).toHaveBeenCalledWith("browser_ai_navigate", { tabId: TAB, url: DEST });
    expect(waitForNavigation).toHaveBeenCalledWith(TAB, "nav-1", NAVIGATION_WAIT_MS);
    expect(onNavigated).toHaveBeenCalledWith({ url: DEST, generation: 4 });
    expect(out).toMatchObject({ outcome: "success", postconditionMet: true });
  });

  it.each([
    ["failed", { kind: "failed", tabId: TAB, navigationId: "nav-1", message: "DNS" }, "NAVIGATION_FAILED"],
    ["timeout", { kind: "timeout", tabId: TAB, navigationId: "nav-1" }, "TIMEOUT"],
    ["superseded", { kind: "superseded", tabId: TAB, navigationId: "nav-1" }, "NAVIGATION_SUPERSEDED"],
  ] as const)("%s → failed + postconditionMet:false (retry-eligible)", async (_kind, result, reason) => {
    const { ctx, onNavigated } = harness({ waitForNavigation: vi.fn(async () => result as BrowserWaitResult) });
    const out = await runNavigateStep(ctx, DEST);
    expect(out).toMatchObject({ outcome: "failed", postconditionMet: false });
    expect(out.reason).toContain(reason);
    expect(onNavigated).not.toHaveBeenCalled();
  });

  it("a timeout that spent the run budget pauses the run as deadline instead of failing the step", async () => {
    const { ctx } = harness({
      clock: clockWith(0, true),
      waitForNavigation: vi.fn(async () => ({ kind: "timeout", tabId: TAB, navigationId: "nav-1" }) as BrowserWaitResult),
    });
    await expect(runNavigateStep(ctx, DEST)).rejects.toMatchObject({ reasonCode: "deadline" });
  });

  it("bounds the wait by the remaining run budget", async () => {
    const { ctx, waitForNavigation } = harness({ clock: clockWith(2_500) });
    await runNavigateStep(ctx, DEST);
    expect(waitForNavigation).toHaveBeenCalledWith(TAB, "nav-1", 2_500);
  });

  it("a disabled/unmounted surface stops and asks (no retry against a missing surface)", async () => {
    const { ctx } = harness({
      waitForNavigation: vi.fn(async () => ({ kind: "unmounted", tabId: TAB, navigationId: "nav-1" }) as BrowserWaitResult),
    });
    const out = await runNavigateStep(ctx, DEST);
    expect(out).toEqual({ outcome: "failed", reason: "WINDOW_UNAVAILABLE" });
  });

  it("a ticket without a navigationId stops and asks", async () => {
    invoke.mockResolvedValue({});
    const { ctx } = harness();
    const out = await runNavigateStep(ctx, DEST);
    expect(out).toMatchObject({ outcome: "failed" });
    expect(out.postconditionMet).toBeUndefined();
  });

  it("an abort during the wait ends the step at once with the abort reason", async () => {
    const never = vi.fn<NavigateStepContext["waitForNavigation"]>(() => new Promise<BrowserWaitResult>(() => {}));
    const { ctx, controller } = harness({ waitForNavigation: never });
    const step = runNavigateStep(ctx, DEST);
    await Promise.resolve();
    controller.abort(new WorkflowPause("cancelled", "cancelled"));
    await expect(step).rejects.toMatchObject({ reasonCode: "cancelled" });
  });
});

describe("runNavigateStep — approval like a hand-issued navigate (audit low item)", () => {
  it("does not pre-gate: the driver decides, and an approval-required refusal prompts on the DESTINATION origin, then retries once", async () => {
    invoke.mockRejectedValueOnce(approvalRequired()).mockResolvedValueOnce({ tabId: TAB, navigationId: "nav-2" });
    const { ctx, authorize } = harness();
    const out = await runNavigateStep(ctx, DEST);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith({ url: DEST, operation: "navigate" });
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ outcome: "success", postconditionMet: true });
  });

  it("a second approval-required refusal is a stop-and-ask failure, never a prompt loop", async () => {
    invoke.mockRejectedValue(approvalRequired());
    const { ctx, authorize } = harness();
    const out = await runNavigateStep(ctx, DEST);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ outcome: "failed", reason: "APPROVAL_REQUIRED" });
  });

  it("a non-approval refusal (policy, stale tab) is a stop-and-ask failure carrying the driver's token", async () => {
    invoke.mockRejectedValue({ code: "permission-denied", message: "private address", detail: { mcpCode: "DESTINATION_BLOCKED" } });
    const { ctx, authorize } = harness();
    const out = await runNavigateStep(ctx, DEST);
    expect(authorize).not.toHaveBeenCalled();
    expect(out).toEqual({ outcome: "failed", reason: "DESTINATION_BLOCKED" });
  });

  it("a pause raised while waiting for the navigate approval propagates", async () => {
    invoke.mockRejectedValueOnce(approvalRequired());
    const { ctx } = harness({
      authorize: vi.fn(async () => {
        throw new WorkflowPause("denied", "denied");
      }),
    });
    await expect(runNavigateStep(ctx, DEST)).rejects.toMatchObject({ reasonCode: "denied" });
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
