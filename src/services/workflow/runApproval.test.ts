// @vitest-environment node
// Audit 2026-09-03 W-01 / W-06 / W-09 — the run-scoped approval wait: the D1v2
// state machine (approved / denied / dropped-by-navigation / queue-full /
// cancelled / lease-lost), cancellable before any mint, clock paused while the
// prompt is open, pendingApproval mirrored for status.
// timer-isolation: intentional real timers — the poll loop's abortable sleep IS the
// subject: every `awaitAuthorization` promise a test starts is awaited to settlement
// inside that test (resolve, reject or abort), and `abortableSleep` clears its timer on
// each of those, so no production timer can outlive a test's last assertion. pollMs is
// 1 ms; the 5–10 ms sleeps here are the poll's own cadence, not a race window.
import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const mint = vi.fn();
const revoke = vi.fn();
vi.mock("@/services/browser/grantSync", () => ({
  mintOneShotConfirmed: (...a: unknown[]) => mint(...a),
  revokeOneShot: (...a: unknown[]) => revoke(...a),
}));

import { awaitAuthorization, type ApprovalWaitContext } from "./runApproval";
import type { PendingApprovalInfo } from "./runRegistry";
import type { RunClock } from "./runClock";
import { useBrowserApprovalStore, MAX_PENDING_APPROVALS } from "@/stores/browserApprovalStore";
import { useBrowserLeaseStore } from "@/services/browser/lease";
import { WorkflowPause } from "@/lib/browser/workflow/engine";

const URL = "https://blog.example.com/post";
const ORIGIN = "https://blog.example.com";
const TAB = "tab-1";
const TARGET = { role: "button", name: "Publish" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function spyClock(): RunClock & { pause: Mock<() => void>; resume: Mock<() => void> } {
  return { pause: vi.fn<() => void>(), resume: vi.fn<() => void>(), elapsed: () => 0, remaining: () => 1e9, expired: () => false, paused: false };
}

function harness(over: Partial<ApprovalWaitContext> = {}) {
  const controller = new AbortController();
  const tab = { url: URL, generation: 3 };
  const pendingLog: Array<PendingApprovalInfo | null> = [];
  const clock = spyClock();
  const ctx: ApprovalWaitContext = {
    tabId: TAB,
    runId: "run-1",
    signal: controller.signal,
    clock,
    leaseEpoch: 0,
    resolveTab: () => tab,
    now: () => 1000,
    pollMs: 1,
    onPendingApproval: (info) => pendingLog.push(info),
    ...over,
  };
  return { ctx, controller, tab, pendingLog, clock };
}

const runPrompt = () => useBrowserApprovalStore.getState().pending.find((p) => p.runId === "run-1");

beforeEach(() => {
  invoke.mockReset();
  mint.mockReset().mockResolvedValue(true);
  revoke.mockReset().mockResolvedValue(undefined);
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
  useBrowserLeaseStore.setState({ leases: {}, inflightCancel: {} });
});

describe("awaitAuthorization — no prompt needed", () => {
  it("a standing grant authorizes at once, with no prompt and no mint", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const { ctx, pendingLog } = harness();
    await expect(awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET })).resolves.toEqual({ url: URL, generation: 3 });
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
    expect(mint).not.toHaveBeenCalled();
    expect(pendingLog).toEqual([]);
  });

  it("an existing one-shot is consumed and its Rust mint awaited (the store's own pattern and generation)", async () => {
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", TARGET, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once");
    const { ctx } = harness();
    await awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);
    expect(mint).toHaveBeenCalledWith({ originPattern: ORIGIN, operation: "click", tabId: TAB, generation: 3, target: TARGET });
  });

  it("an unknown (never-automatable) operation is denied outright", async () => {
    const { ctx } = harness();
    await expect(awaitAuthorization(ctx, { url: URL, operation: "upload" })).rejects.toMatchObject({ reasonCode: "denied" });
  });

  it("a refused mint is an error (needs-human), never an act", async () => {
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", TARGET, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once");
    mint.mockResolvedValue(false);
    const { ctx } = harness();
    await expect(awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET })).rejects.toThrow(/refused/);
  });
});

describe("awaitAuthorization — a navigate is about its DESTINATION (round 3, #184)", () => {
  const DEST = "https://dest.example/landing?x=1";
  it("a grant on the destination origin authorizes the navigation, whatever the current page grants", async () => {
    useBrowserApprovalStore.getState().grant("https://dest.example", ["navigate"]);
    const { ctx } = harness();
    const page = await awaitAuthorization(ctx, { url: DEST, operation: "navigate" });
    expect(page).toEqual({ url: DEST, generation: 3 });
    expect(runPrompt()).toBeUndefined();
  });
  it("a grant on the CURRENT page does not authorize navigating elsewhere: the prompt names the destination", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["navigate"]);
    const { ctx, controller } = harness();
    const wait = awaitAuthorization(ctx, { url: DEST, operation: "navigate" });
    await sleep(5);
    expect(runPrompt()).toMatchObject({ operation: "navigate", targetUrl: DEST, generation: 3 });
    controller.abort(new WorkflowPause("cancelled", "test over"));
    await expect(wait).rejects.toBeInstanceOf(WorkflowPause);
  });
});

describe("awaitAuthorization — requireFreshApproval (round 3, #162)", () => {
  it("a standing grant does not settle a healed write: a prompt is raised, and 'once' authorizes it", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const { ctx } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET, requireFreshApproval: true });
    await sleep(5);
    const prompt = runPrompt();
    expect(prompt).toMatchObject({ operation: "click", target: TARGET });
    useBrowserApprovalStore.getState().resolveApproval(prompt!.id, "once");
    await expect(wait).resolves.toEqual({ url: URL, generation: 3 });
    expect(mint).toHaveBeenCalledTimes(1);
  });
  it("a denied origin is still denied outright, fresh or not", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    const { ctx } = harness();
    await expect(awaitAuthorization(ctx, { url: URL, operation: "upload", requireFreshApproval: true })).rejects.toMatchObject({ reasonCode: "denied" });
  });
});

describe("awaitAuthorization — the prompt path", () => {
  it("raises a run-tagged prompt carrying the bound script and summary, pauses the clock, mirrors pendingApproval", async () => {
    const { ctx, pendingLog, clock } = harness();
    const wait = awaitAuthorization(ctx, {
      url: URL,
      operation: "type",
      target: { role: "textbox", name: "Title" },
      script: "SCRIPT",
      payloadSummary: 'Text: "Hello"',
    });
    await sleep(5);
    const prompt = runPrompt();
    expect(prompt).toMatchObject({
      runId: "run-1",
      operation: "type",
      targetUrl: URL,
      tabId: TAB,
      generation: 3,
      target: { role: "textbox", name: "Title" },
      script: "SCRIPT",
      payloadSummary: 'Text: "Hello"',
    });
    expect(pendingLog).toEqual([{ operation: "type", url: ORIGIN, target: { role: "textbox", name: "Title" } }]);
    expect(clock.pause).toHaveBeenCalledTimes(1);
    expect(clock.resume).not.toHaveBeenCalled();

    useBrowserApprovalStore.getState().resolveApproval(prompt!.id, "once");
    await expect(wait).resolves.toEqual({ url: URL, generation: 3 });
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ operation: "type", script: "SCRIPT", generation: 3 }));
    expect(clock.resume).toHaveBeenCalledTimes(1);
    expect(pendingLog.at(-1)).toBeNull();
  });

  it("'remember' resolves through the standing grant with no mint", async () => {
    const { ctx } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    useBrowserApprovalStore.getState().resolveApproval(runPrompt()!.id, "remember");
    await expect(wait).resolves.toBeDefined();
    expect(mint).not.toHaveBeenCalled();
  });

  it("'deny' pauses the run as denied (the prompt vanished, the page did not move)", async () => {
    const { ctx, clock } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    useBrowserApprovalStore.getState().resolveApproval(runPrompt()!.id, "deny");
    await expect(wait).rejects.toMatchObject({ reasonCode: "denied" });
    expect(clock.resume).toHaveBeenCalledTimes(1);
  });

  it("a prompt dropped by navigation is re-requested ONCE against the new page, then pauses dropped-by-navigation", async () => {
    const { ctx, tab } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    const first = runPrompt()!;
    // The page moves: BrowserSurface dismisses the tab's prompts and advances the generation.
    tab.generation = 4;
    tab.url = "https://blog.example.com/moved";
    useBrowserApprovalStore.getState().dismissForNavigation(TAB);
    await sleep(10);
    const second = runPrompt()!;
    expect(second.id).not.toBe(first.id);
    expect(second).toMatchObject({ generation: 4, targetUrl: "https://blog.example.com/moved", runId: "run-1" });
    tab.generation = 5;
    useBrowserApprovalStore.getState().dismissForNavigation(TAB);
    await expect(wait).rejects.toMatchObject({ reasonCode: "dropped-by-navigation" });
    expect(useBrowserApprovalStore.getState().pending.filter((p) => p.runId === "run-1")).toHaveLength(0);
  });

  it("an approval after a navigation re-request authorizes the NEW page", async () => {
    const { ctx, tab } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    tab.generation = 4;
    useBrowserApprovalStore.getState().dismissForNavigation(TAB);
    await sleep(10);
    useBrowserApprovalStore.getState().resolveApproval(runPrompt()!.id, "once");
    await expect(wait).resolves.toEqual({ url: URL, generation: 4 });
    expect(mint).toHaveBeenCalledWith(expect.objectContaining({ generation: 4 }));
  });

  it("a full prompt queue pauses the run as queue-full instead of pretending a prompt exists", async () => {
    useBrowserApprovalStore.setState({
      pending: Array.from({ length: MAX_PENDING_APPROVALS }, (_, i) => ({
        id: `flood-${i}`,
        targetUrl: URL,
        operation: "click",
        tabId: TAB,
        generation: 3,
      })),
    });
    const { ctx, clock } = harness();
    await expect(awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET })).rejects.toMatchObject({ reasonCode: "queue-full" });
    expect(clock.pause).not.toHaveBeenCalled();
  });
});

describe("awaitAuthorization — cancel and takeover interrupt the wait (W-01)", () => {
  it("an abort ends the wait at once and a later approval mints nothing", async () => {
    const { ctx, controller, clock } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    const prompt = runPrompt()!;
    controller.abort(new WorkflowPause("cancelled", "cancelled by user"));
    await expect(wait).rejects.toMatchObject({ reasonCode: "cancelled" });
    expect(clock.resume).toHaveBeenCalledTimes(1);
    // The run is gone; the user answers the stale prompt anyway.
    useBrowserApprovalStore.getState().resolveApproval(prompt.id, "once");
    await sleep(5);
    expect(mint).not.toHaveBeenCalled();
  });

  it("a moved lease epoch (human takeover) ends the wait as lease-lost", async () => {
    useBrowserLeaseStore.getState().acquireForAi(TAB);
    const { ctx } = harness({ leaseEpoch: useBrowserLeaseStore.getState().epochOf(TAB) });
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    useBrowserLeaseStore.getState().reclaimForHuman(TAB);
    await expect(wait).rejects.toMatchObject({ reasonCode: "lease-lost" });
    expect(mint).not.toHaveBeenCalled();
  });

  it("an already-aborted run never raises a prompt", async () => {
    const { ctx, controller } = harness();
    controller.abort(new WorkflowPause("cancelled", "x"));
    await expect(awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET })).rejects.toMatchObject({ reasonCode: "cancelled" });
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(0);
  });

  it("a mint that confirms AFTER the abort is revoked on the driver (round 3, #124)", async () => {
    let confirm: (ok: boolean) => void = () => {};
    mint.mockImplementationOnce(() => new Promise<boolean>((r) => (confirm = r)));
    useBrowserApprovalStore.getState().requestApproval("seed", URL, "click", TARGET, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("seed", "once");
    const { ctx, controller } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    controller.abort(new WorkflowPause("cancelled", "stop"));
    await expect(wait).rejects.toBeInstanceOf(WorkflowPause);
    expect(revoke).not.toHaveBeenCalled();
    confirm(true);
    await sleep(5);
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ tabId: TAB, generation: 3, operation: "click", target: TARGET, originPattern: ORIGIN }));
  });

  it("a late payload-bound mint is revoked WITH its script — the identity the driver bound", async () => {
    let confirm: (ok: boolean) => void = () => {};
    mint.mockImplementationOnce(() => new Promise<boolean>((r) => (confirm = r)));
    useBrowserApprovalStore.getState().requestApproval("seed", URL, "type", TARGET, TAB, 3, "SCRIPT");
    useBrowserApprovalStore.getState().resolveApproval("seed", "once");
    const { ctx, controller } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "type", target: TARGET, script: "SCRIPT" });
    await sleep(5);
    controller.abort(new WorkflowPause("cancelled", "stop"));
    await expect(wait).rejects.toBeInstanceOf(WorkflowPause);
    confirm(true);
    await sleep(5);
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ operation: "type", script: "SCRIPT" }));
  });

  it("a late mint that the driver REFUSED has nothing to revoke", async () => {
    let confirm: (ok: boolean) => void = () => {};
    mint.mockImplementationOnce(() => new Promise<boolean>((r) => (confirm = r)));
    useBrowserApprovalStore.getState().requestApproval("seed", URL, "click", TARGET, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("seed", "once");
    const { ctx, controller } = harness();
    const wait = awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET });
    await sleep(5);
    controller.abort(new WorkflowPause("cancelled", "stop"));
    await expect(wait).rejects.toBeInstanceOf(WorkflowPause);
    confirm(false);
    await sleep(5);
    expect(revoke).not.toHaveBeenCalled();
  });

  it("an abort that lands while the one-shot is being minted still never acts", async () => {
    useBrowserApprovalStore.getState().requestApproval("p", URL, "click", TARGET, TAB, 3);
    useBrowserApprovalStore.getState().resolveApproval("p", "once");
    const { ctx, controller } = harness();
    mint.mockImplementation(async () => {
      controller.abort(new WorkflowPause("cancelled", "x"));
      return true;
    });
    await expect(awaitAuthorization(ctx, { url: URL, operation: "click", target: TARGET })).rejects.toMatchObject({ reasonCode: "cancelled" });
  });
});
