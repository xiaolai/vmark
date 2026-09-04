// @vitest-environment node
// Round 4, #37 — the frontend's human-tab attachment mirror is reconciled to the
// DRIVER's report after a rejected call, never inferred from the rejection's token.
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";
import {
  parseAttachmentReport,
  reconciledAttachments,
  reconcileAttachmentMirror,
} from "@/services/mcpBridge/v2/browserAttachmentMirror";

describe("parseAttachmentReport", () => {
  it("accepts the two wire shapes the driver sends", () => {
    expect(parseAttachmentReport({ attached: false, generation: null, once: null })).toEqual({ attached: false });
    expect(parseAttachmentReport({ attached: true, generation: 7, once: true })).toEqual({
      attached: true,
      generation: 7,
      once: true,
    });
    expect(parseAttachmentReport({ attached: true, generation: 0, once: false })).toEqual({
      attached: true,
      generation: 0,
      once: false,
    });
    // u64::MAX arrives as a JS float, still integral.
    expect(parseAttachmentReport({ attached: true, generation: 1.8446744073709552e19, once: false })?.attached).toBe(true);
  });

  it("rejects anything else rather than guessing", () => {
    const malformed: unknown[] = [
      null,
      undefined,
      "attached",
      1,
      [],
      {},
      { attached: "yes" },
      { attached: true },
      { attached: true, generation: null, once: true },
      { attached: true, generation: 2, once: null },
      { attached: true, generation: "2", once: true },
      { attached: true, generation: Number.NaN, once: true },
      { attached: true, generation: -1, once: true },
      { attached: true, generation: 1.5, once: true },
      { attached: true, generation: 2, once: "true" },
    ];
    for (const bad of malformed) {
      expect(parseAttachmentReport(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("reconciledAttachments", () => {
  const other = { tabId: "other", generation: 1, once: false };

  it("drops every entry for the tab when the driver holds no attachment", () => {
    const list = [other, { tabId: "t1", generation: 2, once: true }, { tabId: "t1", generation: 3, once: false }];
    expect(reconciledAttachments(list, "t1", { attached: false })).toEqual([other]);
  });

  it("replaces the tab's entry with exactly what the driver reports — one entry per tab", () => {
    const list = [other, { tabId: "t1", generation: 2, once: true }];
    expect(reconciledAttachments(list, "t1", { attached: true, generation: 3, once: false })).toEqual([
      other,
      { tabId: "t1", generation: 3, once: false },
    ]);
  });

  it("restores an entry the mirror lost but the driver still holds", () => {
    expect(reconciledAttachments([other], "t1", { attached: true, generation: 2, once: true })).toEqual([
      other,
      { tabId: "t1", generation: 2, once: true },
    ]);
  });

  it("leaves a matching mirror as it was", () => {
    const list = [other, { tabId: "t1", generation: 2, once: true }];
    expect(reconciledAttachments(list, "t1", { attached: true, generation: 2, once: true })).toEqual(list);
  });

  it("does not mutate its input", () => {
    const list = [{ tabId: "t1", generation: 2, once: true }];
    reconciledAttachments(list, "t1", { attached: false });
    expect(list).toEqual([{ tabId: "t1", generation: 2, once: true }]);
  });
});

describe("reconcileAttachmentMirror", () => {
  const tab = { tabId: "t1", generation: 2 };
  const other = { tabId: "other", generation: 5, once: true };
  const attachments = () => useBrowserApprovalStore.getState().attachments;

  beforeEach(() => {
    invoke.mockReset();
    useBrowserApprovalStore.setState({
      grants: [],
      pending: [],
      oneShots: [],
      attachments: [other, { tabId: "t1", generation: 2, once: true }],
    });
  });

  it("asks the driver about THIS tab and keeps the mirror it still holds", async () => {
    invoke.mockResolvedValue({ attached: true, generation: 2, once: true });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("attached");
    expect(invoke).toHaveBeenCalledExactlyOnceWith("browser_ai_attachment_state", { tabId: "t1" });
    expect(attachments()).toEqual([other, { tabId: "t1", generation: 2, once: true }]);
  });

  it("drops the mirror when the driver reports no attachment", async () => {
    invoke.mockResolvedValue({ attached: false, generation: null, once: null });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("detached");
    expect(attachments()).toEqual([other]);
  });

  it("reconciles to the generation and mode the driver reports", async () => {
    invoke.mockResolvedValue({ attached: true, generation: 3, once: false });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("attached");
    expect(attachments()).toEqual([other, { tabId: "t1", generation: 3, once: false }]);
  });

  it("fails safe when the query rejects: the one-use entry is spent, other tabs untouched", async () => {
    invoke.mockRejectedValue({ code: "not-found", message: "no such tab", detail: { mcpCode: "TAB_NOT_FOUND" } });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("unknown");
    expect(attachments()).toEqual([other]);
  });

  it("fails safe when the report is malformed", async () => {
    invoke.mockResolvedValue({ attached: "yes" });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("unknown");
    expect(attachments()).toEqual([other]);
  });

  it("the fail-safe spends only what the driver could have: a standing entry stays", async () => {
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: false }] });
    invoke.mockRejectedValue(new Error("IPC channel closed"));
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("unknown");
    expect(attachments()).toEqual([{ tabId: "t1", generation: 2, once: false }]);
  });

  it("drops a standing entry the driver no longer holds — the lockout case", async () => {
    useBrowserApprovalStore.setState({ attachments: [{ tabId: "t1", generation: 2, once: false }] });
    invoke.mockResolvedValue({ attached: false, generation: null, once: null });
    await expect(reconcileAttachmentMirror(tab)).resolves.toBe("detached");
    expect(attachments()).toEqual([]);
  });
});
