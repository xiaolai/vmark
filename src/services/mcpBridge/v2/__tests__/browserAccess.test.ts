// @vitest-environment node
// Audit 2026-09-03 A-01 / X-04 — the shared browser gate and the attachment mirror.
import { describe, it, expect, beforeEach, vi } from "vitest";

const respond = vi.fn();
vi.mock("@/services/mcpBridge/utils", () => ({ respond: (...a: unknown[]) => respond(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { browserGate, invokeAttached, attachmentSpentBy, hasOnceAttachment } from "@/services/mcpBridge/v2/browserAccess";
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
