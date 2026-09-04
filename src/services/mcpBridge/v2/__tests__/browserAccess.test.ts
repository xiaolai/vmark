// @vitest-environment node
// Audit 2026-09-03 A-01 / X-04 — the shared browser gate and the attachment mirror.
import { describe, it, expect, beforeEach, vi } from "vitest";

const respond = vi.fn();
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/services/persistence/workspaceStorage", () => ({ getCurrentWindowLabel: () => "main" }));

import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabStore } from "@/stores/tabStore";
import {
  browserGate,
  invokeAttached,
  attachmentSpentBy,
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

describe("attachmentSpentBy", () => {
  it("is false for every refusal the driver returns before it spends", () => {
    for (const token of ["STALE_COMMAND", "NOT_GRANTED", "ATTACHMENT_REQUIRED", "NO_COMMITTED_PAGE", "TAB_NOT_FOUND", "POLICY_STALE", "PROFILE_ORIGIN_CONFINED", "BROWSER_DISABLED"]) {
      expect(attachmentSpentBy({ code: "conflict", message: "x", detail: { mcpCode: token } }), token).toBe(false);
    }
  });
  it("is true for a post-authorization failure and for an untyped error", () => {
    expect(attachmentSpentBy({ code: "timeout", message: "x", detail: { mcpCode: "EVAL_TIMEOUT" } })).toBe(true);
    expect(attachmentSpentBy(new Error("boom"))).toBe(true);
    expect(attachmentSpentBy("surface failed")).toBe(true);
  });
});

describe("invokeAttached", () => {
  const attachOnce = () =>
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: true }] });
  const attached = () => useBrowserApprovalStore.getState().isHumanTabAttached("t1", 2);

  it("spends a once-attachment on success", async () => {
    attachOnce();
    await expect(invokeAttached(human, async () => "ok")).resolves.toBe("ok");
    expect(attached()).toBe(false);
  });

  it("spends it on a post-authorization failure (the driver already did)", async () => {
    attachOnce();
    await expect(
      invokeAttached(human, async () => {
        throw { code: "timeout", message: "eval timed out", detail: { mcpCode: "EVAL_TIMEOUT" } };
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(attached()).toBe(false);
  });

  it("keeps it on a pre-authorization refusal (the driver did not spend)", async () => {
    attachOnce();
    await expect(
      invokeAttached(human, async () => {
        throw { code: "conflict", message: "stale", detail: { mcpCode: "STALE_COMMAND" } };
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(attached()).toBe(true);
  });

  it("leaves a standing attachment in place and ignores AI tabs", async () => {
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: false }] });
    await invokeAttached(human, async () => 1);
    expect(attached()).toBe(true);
    expect(hasOnceAttachment(human)).toBe(false);
    await expect(invokeAttached(ai, async () => 2)).resolves.toBe(2);
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

  it("refuses when nothing resolves: an unknown id, a document tab, or no active browser tab", async () => {
    const docId = useTabStore.getState().createTab("main", "/a.md");
    for (const args of [{ tabId: "nope" }, { tabId: docId }, {}]) {
      expect(await resolveBrowserTarget("none", args)).toBeNull();
      expect(lastResponse()).toEqual({ id: "none", success: false, error: "no active browser tab" });
    }
  });
});
