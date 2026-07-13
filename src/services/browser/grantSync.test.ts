// WI-2.1 — mirror standing grants into the Rust driver (the authoritative gate).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { startGrantSync } from "./grantSync";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useBrowserApprovalStore.setState({ grants: [], pending: [] });
});

describe("startGrantSync", () => {
  it("pushes the current grants to the driver immediately", () => {
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://a.com", operations: ["click"] }],
      pending: [],
    });

    const stop = startGrantSync();

    // The driver must not be left default-deny while the store already holds
    // grants (e.g. after a window reload) — sync on start, not only on change.
    expect(invoke).toHaveBeenCalledWith("browser_set_grants", {
      grants: [{ originPattern: "https://a.com", operations: ["click"] }],
    });
    stop();
  });

  it("pushes on every grant change", () => {
    const stop = startGrantSync();
    invoke.mockClear();

    useBrowserApprovalStore.getState().grant("https://b.com", ["read", "type"]);

    expect(invoke).toHaveBeenCalledWith("browser_set_grants", {
      grants: [{ originPattern: "https://b.com", operations: ["read", "type"] }],
    });
    stop();
  });

  it("pushes an empty set on revoke — a revoked grant must reach the driver", () => {
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://a.com", operations: ["click"] }],
      pending: [],
    });
    const stop = startGrantSync();
    invoke.mockClear();

    useBrowserApprovalStore.getState().revoke("https://a.com");

    expect(invoke).toHaveBeenCalledWith("browser_set_grants", { grants: [] });
    stop();
  });

  it("ignores unrelated store churn (pending approvals) — no redundant IPC", () => {
    const stop = startGrantSync();
    invoke.mockClear();

    useBrowserApprovalStore.getState().requestApproval("p1", "https://a.com", "click");

    expect(invoke).not.toHaveBeenCalled();
    stop();
  });

  it("stops syncing after the returned disposer runs", () => {
    const stop = startGrantSync();
    stop();
    invoke.mockClear();

    useBrowserApprovalStore.getState().grant("https://c.com", ["read"]);

    expect(invoke).not.toHaveBeenCalled();
  });

  it("survives a driver that rejects the sync (no unhandled rejection)", async () => {
    invoke.mockRejectedValue(new Error("driver unavailable"));
    const stop = startGrantSync();
    useBrowserApprovalStore.getState().grant("https://d.com", ["read"]);
    // A failed sync must not throw into the store subscriber. The driver simply
    // keeps its previous (more restrictive or equal) grant set — fail-closed.
    await Promise.resolve();
    stop();
    expect(invoke).toHaveBeenCalled();
  });
});

// "Allow once" must reach the DRIVER. The first version minted the one-shot in
// the TS store only, while the Rust gate still demanded a standing grant — the
// frontend authorized the action and the driver then refused it. A one-shot that
// the authority never hears about authorizes nothing.
describe("one-shot sync", () => {
  it("pushes a newly minted one-shot to the driver", () => {
    const stop = startGrantSync();
    invoke.mockClear();

    useBrowserApprovalStore.getState().requestApproval("r1", "https://blog.example.com/p", "click");
    useBrowserApprovalStore.getState().resolveApproval("r1", "once");

    expect(invoke).toHaveBeenCalledWith("browser_add_one_shot", {
      originPattern: "https://blog.example.com",
      operation: "click",
    });
    stop();
  });

  it("does NOT re-push one-shots the driver has already consumed", () => {
    // The driver consumes them as actions run, so re-pushing the whole list would
    // resurrect spent authority. Only additions are sent.
    const stop = startGrantSync();
    useBrowserApprovalStore.getState().requestApproval("r2", "https://a.com", "click");
    useBrowserApprovalStore.getState().resolveApproval("r2", "once");
    invoke.mockClear();

    // An unrelated store change must not re-push the existing one-shot.
    useBrowserApprovalStore.getState().grant("https://b.com", ["read"]);

    expect(invoke).not.toHaveBeenCalledWith("browser_add_one_shot", expect.anything());
    stop();
  });

  it("does not push a one-shot for 'remember' (that is a standing grant)", () => {
    const stop = startGrantSync();
    useBrowserApprovalStore.getState().requestApproval("r3", "https://a.com", "click");
    invoke.mockClear();
    useBrowserApprovalStore.getState().resolveApproval("r3", "remember");

    expect(invoke).not.toHaveBeenCalledWith("browser_add_one_shot", expect.anything());
    expect(invoke).toHaveBeenCalledWith("browser_set_grants", expect.anything());
    stop();
  });
});
