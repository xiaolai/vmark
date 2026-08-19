// @vitest-environment node
// WI-NB5.3 — run-scoped approvals: prompts raised by a workflow run carry its
// runId, and ending the run WITHDRAWS its pending prompts so a late "Allow"
// cannot mint an orphan one-shot (Codex review CO2).
import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";

const URL = "https://site.example.com/page";

beforeEach(() => {
  useBrowserApprovalStore.setState({ grants: [], pending: [], oneShots: [], attachments: [], profileOpens: [] });
});

describe("run-scoped pending approvals", () => {
  it("requestApproval records the runId on the pending entry", () => {
    const out = useBrowserApprovalStore
      .getState()
      .requestApproval("req-1", URL, "click", { role: "button", name: "OK" }, "tab-1", 3, undefined, "run-7");
    expect(out).toBe("queued");
    expect(useBrowserApprovalStore.getState().pending[0]).toMatchObject({ id: "req-1", runId: "run-7" });
  });

  it("withdrawByRun drops exactly that run's prompts", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("a", URL, "click", undefined, "tab-1", 1, undefined, "run-7");
    s.requestApproval("b", URL, "type", undefined, "tab-1", 1, undefined, "run-8");
    s.requestApproval("c", URL, "click", undefined, "tab-1", 1);
    useBrowserApprovalStore.getState().withdrawByRun("run-7");
    expect(useBrowserApprovalStore.getState().pending.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("a resolve AFTER withdrawal mints nothing (the late-Allow race)", () => {
    const s = useBrowserApprovalStore.getState();
    s.requestApproval("late", URL, "click", { role: "button", name: "Pay" }, "tab-1", 2, undefined, "run-9");
    useBrowserApprovalStore.getState().withdrawByRun("run-9");
    useBrowserApprovalStore.getState().resolveApproval("late", "once");
    expect(useBrowserApprovalStore.getState().oneShots).toHaveLength(0);
    expect(useBrowserApprovalStore.getState().grants).toHaveLength(0);
  });

  it("a runless prompt is untouched by any withdrawal", () => {
    useBrowserApprovalStore.getState().requestApproval("solo", URL, "click", undefined, "tab-1", 1);
    useBrowserApprovalStore.getState().withdrawByRun("run-anything");
    expect(useBrowserApprovalStore.getState().pending).toHaveLength(1);
  });
});
