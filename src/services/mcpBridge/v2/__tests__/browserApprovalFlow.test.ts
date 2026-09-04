// @vitest-environment node
// Round 3, #43/#59/#42 — the ONE approval state machine behind every gated browser
// operation: decision → one-shot consumption → prompt queue → driver mint, with
// explicit outcomes. Each stage is pinned on its own, against the real approval
// store, so the act/power/session/record/navigation callers can be thin.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(() => Promise.resolve());
const respond = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: Parameters<typeof invoke>) => invoke(...a) }));
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));

import { MAX_PENDING_APPROVALS, useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import {
  QUEUE_FULL_MESSAGE,
  authorizeOperation,
  confirmOneShotMint,
  queueApprovalPrompt,
} from "@/services/mcpBridge/v2/browserApprovalFlow";
import type { BrowserTarget } from "@/services/mcpBridge/v2/browserHelpers";

const tab: BrowserTarget = {
  tabId: "t1",
  url: "https://blog.example.com/magic-login/SECRET?code=1",
  generation: 3,
  automationMode: "ai-sandbox",
  windowLabel: "main",
};
const ORIGIN = "https://blog.example.com";
const target = { role: "button", name: "Publish" };

function lastResponse() {
  return respond.mock.calls.at(-1)?.[0] as { id: string; success: boolean; error: string; data?: Record<string, unknown> };
}
/** The user clicks "Allow once" on the prompt `id` raised for `spec`. */
function allowOnce(id: string) {
  useBrowserApprovalStore.getState().resolveApproval(id, "once");
}

beforeEach(() => {
  invoke.mockReset().mockImplementation(() => Promise.resolve());
  respond.mockReset();
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
});

describe("authorizeOperation — the decision stage", () => {
  it("authorizes under a standing grant without a prompt, a one-shot or a driver call", async () => {
    useBrowserApprovalStore.getState().grant(ORIGIN, ["click"]);
    expect(await authorizeOperation("g", tab, { operation: "click", target })).toBe("authorized");
    expect(respond).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses an operation outside the vocabulary and a never-automated one as not permitted", async () => {
    for (const operation of ["frobnicate", "upload"]) {
      expect(await authorizeOperation("d", tab, { operation })).toBe("refused");
      expect(lastResponse()).toEqual({ id: "d", success: false, error: `operation '${operation}' is not permitted` });
    }
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
  });
});

describe("authorizeOperation — the prompt stage", () => {
  it("queues a prompt carrying the bindings and answers needsApproval with an origin-only url", async () => {
    const outcome = await authorizeOperation("p1", tab, {
      operation: "type",
      target,
      script: "SCRIPT",
      payloadSummary: 'Text: "hi"',
    });
    expect(outcome).toBe("queued");
    expect(useBrowserApprovalStore.getState().pending).toEqual([
      {
        id: "p1",
        targetUrl: tab.url,
        operation: "type",
        target,
        tabId: "t1",
        generation: 3,
        script: "SCRIPT",
        payloadSummary: 'Text: "hi"',
      },
    ]);
    expect(lastResponse()).toEqual({
      id: "p1",
      success: false,
      error: `approval required: 'type' on ${ORIGIN}`,
      data: { needsApproval: true, operation: "type", url: ORIGIN, tabId: "t1", generation: 3 },
    });
    // The pre-authorization envelope never carries the credential-bearing path.
    expect(JSON.stringify(lastResponse())).not.toContain("SECRET");
  });

  it("lets the caller describe the subject and add envelope fields", async () => {
    await authorizeOperation("p2", tab, {
      operation: "session",
      script: "save:work_login",
      describe: "'save' session 'work_login'",
      promptData: { action: "save", handle: "work_login" },
    });
    expect(lastResponse().error).toBe(`approval required: 'save' session 'work_login' on ${ORIGIN}`);
    expect(lastResponse().data).toMatchObject({ needsApproval: true, operation: "session", action: "save", handle: "work_login" });
  });

  it("re-answers the existing prompt when the same request id is raised again, without queueing twice", async () => {
    await authorizeOperation("dup", tab, { operation: "click", target });
    expect(await authorizeOperation("dup", tab, { operation: "click", target })).toBe("queued");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
    expect(lastResponse().data).toMatchObject({ needsApproval: true });
  });

  it("reports a full queue as such — never as needsApproval", async () => {
    const store = useBrowserApprovalStore.getState();
    for (let i = 0; i < MAX_PENDING_APPROVALS; i++) {
      store.requestApproval(`fill-${i}`, tab.url, "click", { role: "button", name: `b${i}` }, "t1", 3);
    }
    expect(await authorizeOperation("full", tab, { operation: "style", script: "S" })).toBe("refused");
    expect(lastResponse()).toEqual({ id: "full", success: false, error: QUEUE_FULL_MESSAGE });
  });
});

describe("authorizeOperation — the one-shot and mint stage", () => {
  it("spends the matching one-shot, awaits the driver's mint with every bound field, and authorizes", async () => {
    await authorizeOperation("ask", tab, { operation: "type", target, script: "S" });
    allowOnce("ask");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1);

    expect(await authorizeOperation("retry", tab, { operation: "type", target, script: "S" })).toBe("authorized");
    expect(useBrowserApprovalStore.getState().oneShots).toEqual([]);
    expect(invoke).toHaveBeenCalledWith("browser_add_one_shot", {
      tabId: "t1",
      generation: 3,
      originPattern: ORIGIN,
      operation: "type",
      target,
      evalScript: "S",
    });
    // Authorization is silent: the caller answers once the action has run.
    expect(respond).toHaveBeenCalledTimes(1);
  });

  it("does not spend a one-shot bound to a different script or target — it re-prompts instead", async () => {
    await authorizeOperation("ask", tab, { operation: "style", script: "A" });
    allowOnce("ask");
    expect(await authorizeOperation("swap", tab, { operation: "style", script: "B" })).toBe("queued");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("refuses when the driver refuses the mint, with the frontend copy already spent", async () => {
    await authorizeOperation("ask", tab, { operation: "record" });
    allowOnce("ask");
    invoke.mockRejectedValue({ code: "conflict", message: "stale generation" });
    expect(await authorizeOperation("mint", tab, { operation: "record" })).toBe("refused");
    expect(lastResponse().error).toBe(
      "the driver refused the 'record' authorization — the page may have navigated; retry to be prompted again",
    );
    expect(useBrowserApprovalStore.getState().oneShots).toEqual([]);
  });
});

describe("queueApprovalPrompt", () => {
  it("refuses a never-approvable operation as one that cannot be approved — not as a full queue", async () => {
    expect(await queueApprovalPrompt("u", tab, { operation: "upload" }, tab.url)).toBe("refused");
    expect(lastResponse()).toEqual({ id: "u", success: false, error: "operation 'upload' cannot be approved" });
    expect(useBrowserApprovalStore.getState().pending).toEqual([]);
  });

  it("uses the caller's error token, prompt url and extra fields when given (the navigation envelope)", async () => {
    const outcome = await queueApprovalPrompt(
      "nav",
      { tabId: "t9", generation: 0 },
      {
        operation: "navigate",
        promptError: "APPROVAL_REQUIRED",
        promptUrl: "https://dest.example/path",
        promptData: { retry: { action: "navigate", tabId: "t9" } },
      },
      "https://dest.example/path?token=1",
    );
    expect(outcome).toBe("queued");
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({
      id: "nav",
      operation: "navigate",
      targetUrl: "https://dest.example/path?token=1",
      tabId: "t9",
      generation: 0,
    });
    expect(lastResponse()).toEqual({
      id: "nav",
      success: false,
      error: "APPROVAL_REQUIRED",
      data: {
        needsApproval: true,
        operation: "navigate",
        url: "https://dest.example/path",
        tabId: "t9",
        generation: 0,
        retry: { action: "navigate", tabId: "t9" },
      },
    });
  });
});

describe("confirmOneShotMint", () => {
  it("is false for an opaque origin that has no grant pattern, without asking the driver", async () => {
    expect(await confirmOneShotMint(tab, { operation: "click", target }, "about:blank")).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("mints exactly the bound fields — no target or script key for an op that binds none", async () => {
    expect(await confirmOneShotMint(tab, { operation: "navigate" }, "https://dest.example/x")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("browser_add_one_shot", {
      tabId: "t1",
      generation: 3,
      originPattern: "https://dest.example",
      operation: "navigate",
      target: undefined,
      evalScript: undefined,
    });
  });
});
