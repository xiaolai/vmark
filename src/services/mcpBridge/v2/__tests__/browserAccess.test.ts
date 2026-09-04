// @vitest-environment node
// Audit 2026-09-03 A-01 / X-04 — the shared browser gate and the attachment mirror.
import { describe, it, expect, beforeEach, vi } from "vitest";

const respond = vi.fn();
const invoke = vi.fn();
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  browserGate,
  invokeAttached,
  hasOnceAttachment,
  resolveBrowserTarget,
} from "@/services/mcpBridge/v2/browserAccess";
import type { BrowserTarget } from "@/services/mcpBridge/v2/browserHelpers";

const human: BrowserTarget = { tabId: "t1", url: "https://a.com/x", generation: 2, automationMode: "human", windowLabel: "main" };
const ai: BrowserTarget = { ...human, automationMode: "ai-sandbox" };

function setPlatform(value: string) {
  Object.defineProperty(navigator, "platform", { value, configurable: true });
}

beforeEach(() => {
  respond.mockReset();
  invoke.mockReset();
  setPlatform("MacIntel");
  useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: true } }));
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [] });
});

describe("browserGate", () => {
  it("refuses with UNSUPPORTED_PLATFORM off macOS, before the enabled check", async () => {
    setPlatform("Win32");
    useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: false } }));
    expect(await browserGate("r1")).toBe(false);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1", success: false, error: expect.stringMatching(/^UNSUPPORTED_PLATFORM:/) }),
    );
  });

  it("refuses with BROWSER_DISABLED when the setting is off", async () => {
    useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: false } }));
    expect(await browserGate("r2")).toBe(false);
    expect(respond).toHaveBeenCalledWith({ id: "r2", success: false, error: "BROWSER_DISABLED" });
  });

  it("passes on macOS with the browser on", async () => {
    expect(await browserGate("r3")).toBe(true);
    expect(respond).not.toHaveBeenCalled();
  });
});

describe("invokeAttached", () => {
  const attachOnce = () =>
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: true }] });
  const attached = () => useBrowserApprovalStore.getState().isHumanTabAttached("t1", 2);
  /** What `browser_ai_attachment_state` answers for the tab. */
  const driverReports = (report: unknown) =>
    invoke.mockImplementation(async (command: unknown) => {
      if (command === "browser_ai_attachment_state") return report;
      throw new Error(`unexpected invoke: ${String(command)}`);
    });
  const STILL_ATTACHED = { attached: true, generation: 2, once: true };
  const SPENT = { attached: false, generation: null, once: null };

  it("spends a once-attachment on success without asking the driver — that spend is certain", async () => {
    attachOnce();
    await expect(invokeAttached(human, async () => "ok")).resolves.toBe("ok");
    expect(attached()).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("leaves a standing attachment in place and ignores AI tabs", async () => {
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: false }] });
    await invokeAttached(human, async () => 1);
    expect(attached()).toBe(true);
    expect(hasOnceAttachment(human)).toBe(false);
    await expect(invokeAttached(ai, async () => 2)).resolves.toBe(2);
  });

  it("does not ask the driver for a tab the mirror has no attachment for, or for an AI tab", async () => {
    await expect(invokeAttached(human, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(invokeAttached(ai, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(invoke).not.toHaveBeenCalled();
  });

  // Round 4, #37 — after a REJECTED call the mirror follows the driver's own
  // report, never the rejection's token. Every rejection below is raised by
  // `browser_eval` BEFORE `authorize_driver_op` consumes anything (the policy
  // lock, the script bound, the half-target check — `commands_auth.rs`), plus
  // the two shapes no token can classify; the old denylist read them all as
  // "spent", and the user was prompted for an attachment the driver still held.
  describe("follows the driver's attachment report, not the rejection's token (round 4, #37)", () => {
    const preAuthorizationRejections: [string, unknown][] = [
      ["a poisoned lock (internal, no token)", { code: "internal", message: "browser state unavailable", detail: { detail: "PoisonError" } }],
      ["a script over the size bound (invalid-input)", { code: "invalid-input", message: "script exceeds the 65536-byte limit (70000 bytes)" }],
      ["half a target (invalid-input)", { code: "invalid-input", message: 'a target needs both role and name (got role=Some("button"), name=None)' }],
      ["an explicit INVALID_INPUT token", { code: "invalid-input", message: "bad argument", detail: { mcpCode: "INVALID_INPUT" } }],
      ["an untyped Error from the IPC layer", new Error("IPC channel closed")],
      ["an untyped string", "surface failed"],
      ["a gate refusal token", { code: "conflict", message: "stale", detail: { mcpCode: "STALE_COMMAND" } }],
    ];

    it.each(preAuthorizationRejections)(
      "keeps the mirror on %s when the driver still holds the attachment",
      async (_label, rejection) => {
        attachOnce();
        driverReports(STILL_ATTACHED);
        await expect(invokeAttached(human, async () => { throw rejection; })).rejects.toBe(rejection);
        expect(attached()).toBe(true);
        expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_ai_attachment_state", { tabId: "t1" });
      },
    );

    it("drops the mirror when the driver reports the attachment spent — whatever the token says", async () => {
      const postAuthorization = { code: "timeout", message: "eval timed out", detail: { mcpCode: "EVAL_TIMEOUT" } };
      const gateToken = { code: "conflict", message: "stale", detail: { mcpCode: "STALE_COMMAND" } };
      for (const rejection of [postAuthorization, gateToken]) {
        attachOnce();
        driverReports(SPENT);
        await expect(invokeAttached(human, async () => { throw rejection; })).rejects.toBe(rejection);
        expect(attached()).toBe(false);
      }
    });

    it("drops a STANDING mirror entry the driver no longer holds (the lockout case)", async () => {
      useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: false }] });
      driverReports(SPENT);
      await expect(invokeAttached(human, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(attached()).toBe(false);
    });

    it("reconciles to the generation and mode the driver reports", async () => {
      attachOnce();
      driverReports({ attached: true, generation: 3, once: false });
      await expect(invokeAttached(human, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(useBrowserApprovalStore.getState().attachments).toEqual([{ tabId: "t1", generation: 3, once: false }]);
    });

    it("fails safe when the report cannot be had: the one-use mirror is spent (one extra prompt at worst)", async () => {
      attachOnce();
      invoke.mockRejectedValue({ code: "not-found", message: "no such tab", detail: { mcpCode: "TAB_NOT_FOUND" } });
      await expect(invokeAttached(human, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(attached()).toBe(false);
    });

    it("fails safe on a malformed report", async () => {
      attachOnce();
      driverReports({ attached: "yes" });
      await expect(invokeAttached(human, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
      expect(attached()).toBe(false);
    });

    it("rethrows the ORIGINAL rejection, not the reconcile's", async () => {
      attachOnce();
      invoke.mockRejectedValue(new Error("state query failed"));
      const original = { code: "timeout", message: "eval timed out", detail: { mcpCode: "EVAL_TIMEOUT" } };
      await expect(invokeAttached(human, async () => { throw original; })).rejects.toBe(original);
    });
  });
});

// Round 3, #62 — the envelope every browser handler opens with, in ONE place. It
// used to be copied into the read-class executor, the power tools, the session
// tools, act, wait_for, record and workflow_run, error strings and all.
describe("resolveBrowserTarget", () => {
  const SITE = "https://x.example.com/p";
  function lastResponse() {
    return respond.mock.calls.at(-1)?.[0] as { id: string; success: boolean; error?: string };
  }
  beforeEach(() => {
    useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  });

  it("refuses at the gate first, before reading the request", async () => {
    useSettingsStore.setState((s) => ({ browser: { ...s.browser, enabled: false } }));
    expect(await resolveBrowserTarget("g", { tabId: "" })).toBeNull();
    expect(lastResponse()).toEqual({ id: "g", success: false, error: "BROWSER_DISABLED" });
  });

  it("resolves the tab the request names, with the fields every handler stamps", async () => {
    const id = useTabStore.getState().createBrowserTab("main", SITE, "X", "ai-sandbox");
    useTabStore.getState().updateBrowserTab(id, { generation: 4 });
    expect(await resolveBrowserTarget("r", { tabId: id })).toEqual({
      tabId: id,
      url: SITE,
      generation: 4,
      automationMode: "ai-sandbox",
      windowLabel: "main",
    });
    expect(respond).not.toHaveBeenCalled();
  });

  it("falls back to this window's active browser tab only when tabId is ABSENT", async () => {
    const id = useTabStore.getState().createBrowserTab("main", SITE, "X", "human");
    expect((await resolveBrowserTarget("a", {}))?.tabId).toBe(id);
    for (const tabId of ["", "   ", 42]) {
      expect(await resolveBrowserTarget("bad", { tabId })).toBeNull();
      expect(lastResponse()).toEqual({
        id: "bad",
        success: false,
        error: "tabId must be a non-empty string when supplied",
      });
    }
  });

  it("refuses a NAMED tab that resolves to nothing as TAB_NOT_FOUND: an unknown id, a document tab", async () => {
    // The token `close` and `navigate` speak. An AI holding the id of a tab whose
    // window has closed must learn the tab is gone, not that nothing is active here.
    const docId = useTabStore.getState().createTab("main", "/a.md");
    for (const args of [{ tabId: "nope" }, { tabId: docId }]) {
      expect(await resolveBrowserTarget("none", args)).toBeNull();
      expect(lastResponse()).toEqual({
        id: "none",
        success: false,
        error: "TAB_NOT_FOUND",
        data: { token: "TAB_NOT_FOUND" },
      });
    }
  });

  it("refuses with 'no active browser tab' only when no tab was named and none is active", async () => {
    useTabStore.getState().createTab("main", "/a.md");
    expect(await resolveBrowserTarget("none", {})).toBeNull();
    expect(lastResponse()).toEqual({ id: "none", success: false, error: "no active browser tab" });
  });
});
