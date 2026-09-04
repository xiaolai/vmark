// @vitest-environment node
// WI-NB7.3 — the workflow_record MCP handler: consent-gated start, drain-and-
// finalize stop. Mocks the approval store, the recorder session, and the bridge.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const respondMock = vi.fn<(...a: unknown[]) => Promise<void>>(async () => {});
const invokeMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => "ok");

vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respondMock(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

// The REAL approval store — record is NEVER_GRANTABLE, so decide() always returns
// needs-approval; seeding a one-shot models the user having approved once.
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";

function resetApprovals(): void {
  useBrowserApprovalStore.setState({ grants: [], oneShots: [], pending: [], attachments: [], profileOpens: [] });
}
function seedRecordOneShot(): void {
  // Mint through the store's OWN flow so the one-shot's origin/target shape matches
  // exactly what the handler's consumeOneShot will look for.
  const store = useBrowserApprovalStore.getState();
  store.requestApproval("seed-record", "https://x.test/app", "record", undefined, "t1", 5);
  useBrowserApprovalStore.getState().resolveApproval("seed-record", "once");
}

let enabled = true;
let tab: Record<string, unknown> | null = {
  tabId: "t1",
  url: "https://x.test/app",
  generation: 5,
  automationMode: "ai-sandbox",
};
vi.mock("./browserHelpers", () => ({
  browserEnabled: () => enabled,
  readTabIdArg: (a: Record<string, unknown>) =>
    a.tabId === undefined ? "" : typeof a.tabId === "string" && a.tabId ? a.tabId : null,
  resolveBrowserTab: () => tab,
}));

type StopResult = { source: string; inputs: string[]; eventCount: number; capped: boolean } | null;
const isRecording = vi.fn<(tabId: string) => boolean>(() => false);
const startRecorderSession = vi.fn<(args: StartRecorderArgs) => { ok: true } | { ok: false; error: string }>(() => ({ ok: true }));
const stopRecorderSession = vi.fn<(tabId: string) => Promise<StopResult>>(async () => ({
  source: "SRC",
  inputs: ["a"],
  eventCount: 3,
  capped: false,
}));
vi.mock("@/services/workflow/recorderSession", () => ({
  isRecording: (...a: Parameters<typeof isRecording>) => isRecording(...a),
  startRecorderSession: (...a: Parameters<typeof startRecorderSession>) => startRecorderSession(...a),
  stopRecorderSession: (...a: Parameters<typeof stopRecorderSession>) => stopRecorderSession(...a),
}));

import { handleBrowserWorkflowRecord } from "./browserRecord";
import type { RecorderDeps, StartRecorderArgs } from "@/services/workflow/recorderSession";

function lastRespond(): { success?: boolean; error?: string; data?: Record<string, unknown> } {
  return respondMock.mock.calls.at(-1)?.[0] as never;
}

beforeEach(() => {
  enabled = true;
  tab = { tabId: "t1", url: "https://x.test/app", generation: 5, automationMode: "ai-sandbox" };
  resetApprovals();
  isRecording.mockReturnValue(false);
  startRecorderSession.mockReturnValue({ ok: true });
});
afterEach(() => {
  vi.clearAllMocks();
  resetApprovals();
});

describe("workflow_record — guards", () => {
  it("refuses when the browser is disabled", async () => {
    enabled = false;
    await handleBrowserWorkflowRecord("1", { recordOp: "start" });
    expect(lastRespond()).toMatchObject({ success: false, error: "BROWSER_DISABLED" });
  });

  it("rejects an unknown recordOp", async () => {
    await handleBrowserWorkflowRecord("1", { recordOp: "pause" });
    expect(lastRespond().success).toBe(false);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("refuses to record a human tab", async () => {
    tab = { ...(tab as object), automationMode: "human" };
    await handleBrowserWorkflowRecord("1", { recordOp: "start" });
    expect(lastRespond()).toMatchObject({ success: false, error: "TAB_NOT_AI_OWNED" });
  });
});

describe("workflow_record — start (consent-gated)", () => {
  it("returns needsApproval and does NOT arm when no consent yet", async () => {
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(lastRespond().data).toMatchObject({ needsApproval: true, operation: "record" });
    expect(invokeMock).not.toHaveBeenCalled(); // never armed without consent
    expect(startRecorderSession).not.toHaveBeenCalled();
    // A real pending approval was raised for the record op.
    expect(useBrowserApprovalStore.getState().pending.some((p) => p.operation === "record")).toBe(true);
  });

  it("arms with the record op and starts the session once consent exists", async () => {
    seedRecordOneShot();
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    // Armed via a gated `record` eval, not a read.
    expect(invokeMock).toHaveBeenCalledWith(
      "browser_eval",
      expect.objectContaining({ tabId: "t1", operation: "record", generation: 5 }),
    );
    expect(startRecorderSession).toHaveBeenCalledWith(
      expect.objectContaining({ tabId: "t1", site: "blog", generation: 5, startUrl: "https://x.test/app" }),
    );
    expect(lastRespond()).toMatchObject({ success: true, data: { status: "recording", tabId: "t1" } });
  });

  it("consumes the one-shot against the tab's generation (#63)", async () => {
    seedRecordOneShot();
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1);
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(lastRespond()).toMatchObject({ success: true });
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);
  });

  it("two concurrent starts arm once: the second is refused while the first is in flight (#64)", async () => {
    seedRecordOneShot();
    let release: (v: unknown) => void = () => {};
    invokeMock.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const first = handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalled());
    await handleBrowserWorkflowRecord("2", { recordOp: "start", site: "blog" });
    expect(lastRespond()).toMatchObject({ success: false, error: "recording-already-active" });
    release("ok");
    await first;
    expect(startRecorderSession).toHaveBeenCalledTimes(1);
  });

  it("wires a drain that drops page-forged navigate events and never reads a url (S-03)", async () => {
    seedRecordOneShot();
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    const deps: RecorderDeps = startRecorderSession.mock.calls[0][0].deps;
    invokeMock.mockResolvedValueOnce(
      JSON.stringify({
        events: [
          { type: "navigate", url: "https://evil.example/pwn" },
          { type: "click", role: "button", name: "Go", url: "https://evil.example/x" },
        ],
      }),
    );
    const events = await deps.drainOnce("t1", 5);
    expect(events).toEqual([{ type: "click", role: "button", name: "Go" }]);
    expect(invokeMock).toHaveBeenLastCalledWith("browser_eval", expect.objectContaining({ operation: "read", generation: 5 }));
  });

  it("refuses a duplicate start before arming", async () => {
    seedRecordOneShot();
    isRecording.mockReturnValue(true);
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(invokeMock).not.toHaveBeenCalled();
    expect(lastRespond()).toMatchObject({ success: false, error: "recording-already-active" });
  });

  it("reports a driver refusal to arm without leaving a session", async () => {
    seedRecordOneShot();
    invokeMock.mockRejectedValueOnce(new Error("driver refused"));
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(startRecorderSession).not.toHaveBeenCalled();
    expect(lastRespond().success).toBe(false);
  });

  // Round 3, #65 — the `starting` reservation is atomic with the flow it guards:
  // taken before the first await, and RELEASED with the failure, so a refused arm
  // leaves neither a session nor a reservation behind.
  it("releases the starting reservation when the arm is refused, so the next start runs the flow again", async () => {
    seedRecordOneShot();
    invokeMock.mockRejectedValueOnce(new Error("driver refused"));
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(lastRespond().success).toBe(false);
    expect(startRecorderSession).not.toHaveBeenCalled();
    // A fresh start is not refused as already-active: consent is spent, so it is
    // prompted again — the flow ran, which a leaked reservation would have prevented.
    await handleBrowserWorkflowRecord("2", { recordOp: "start", site: "blog" });
    expect(lastRespond()).toMatchObject({ success: false, data: { needsApproval: true, operation: "record" } });
    // And with consent it proceeds to arm and open the session.
    useBrowserApprovalStore.getState().resolveApproval("2", "once");
    await handleBrowserWorkflowRecord("3", { recordOp: "start", site: "blog" });
    expect(lastRespond()).toMatchObject({ success: true, data: { status: "recording", tabId: "t1" } });
    expect(startRecorderSession).toHaveBeenCalledTimes(1);
  });

  it("rolls the arm back when the recorder refuses the session: the shim is disarmed and nothing is left recording", async () => {
    seedRecordOneShot();
    startRecorderSession.mockReturnValueOnce({ ok: false, error: "recording-already-active" });
    await handleBrowserWorkflowRecord("1", { recordOp: "start", site: "blog" });
    expect(lastRespond()).toMatchObject({ success: false, error: "recording-already-active" });
    const evals = invokeMock.mock.calls
      .filter((c) => c[0] === "browser_eval")
      .map((c) => c[1] as { script: string; operation: string; generation: number });
    // The gated arm, then the read-class disarm against the same generation.
    expect(evals.map((e) => e.operation)).toEqual(["record", "read"]);
    expect(evals[1]).toMatchObject({ generation: 5 });
    expect(evals[1].script).toContain("disarmed");
  });
});

describe("workflow_record — stop", () => {
  it("finalizes and returns the recorded workflow source", async () => {
    await handleBrowserWorkflowRecord("1", { recordOp: "stop" });
    expect(stopRecorderSession).toHaveBeenCalledWith("t1");
    expect(lastRespond()).toMatchObject({
      success: true,
      data: { source: "SRC", inputs: ["a"], eventCount: 3 },
    });
  });

  it("errors when the tab was not recording", async () => {
    stopRecorderSession.mockResolvedValueOnce(null);
    await handleBrowserWorkflowRecord("1", { recordOp: "stop" });
    expect(lastRespond().success).toBe(false);
  });
});
