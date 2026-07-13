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
