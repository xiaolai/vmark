// WI-2.1 — mirror standing grants into the Rust driver (the authoritative gate).
import { describe, it, expect, beforeEach, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { startGrantSync } from "./grantSync";
import { useBrowserApprovalStore } from "@/stores/browserApprovalStore";

/** Drain the microtask queue so a serialized push settles before we assert. */
const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
};

beforeEach(async () => {
  // Let any drain still in flight from a prior test settle against the old mock
  // before we reset — pushes are serialized/async now, so a drain can outlive its
  // test's synchronous body.
  await flush();
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

  it("pushes on every grant change", async () => {
    const stop = startGrantSync();
    await flush(); // let the start push settle so the next push is not serialized behind it
    invoke.mockClear();

    useBrowserApprovalStore.getState().grant("https://b.com", ["read", "type"]);
    await flush();

    expect(invoke).toHaveBeenCalledWith("browser_set_grants", {
      grants: [{ originPattern: "https://b.com", operations: ["read", "type"] }],
    });
    stop();
  });

  it("pushes an empty set on revoke — a revoked grant must reach the driver", async () => {
    useBrowserApprovalStore.setState({
      grants: [{ originPattern: "https://a.com", operations: ["click"] }],
      pending: [],
    });
    const stop = startGrantSync();
    await flush();
    invoke.mockClear();

    useBrowserApprovalStore.getState().revoke("https://a.com");
    await flush();

    expect(invoke).toHaveBeenCalledWith("browser_set_grants", { grants: [] });
    stop();
  });

  it("ignores unrelated store churn (pending approvals) — no redundant IPC", async () => {
    const stop = startGrantSync();
    await flush();
    invoke.mockClear();

    useBrowserApprovalStore.getState().requestApproval("p1", "https://a.com", "click");
    await flush();

    expect(invoke).not.toHaveBeenCalled();
    stop();
  });

  it("stops syncing after the returned disposer runs", async () => {
    const stop = startGrantSync();
    await flush();
    stop();
    invoke.mockClear();

    useBrowserApprovalStore.getState().grant("https://c.com", ["read"]);
    await flush();

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

  it("does not push a one-shot for 'remember' (that is a standing grant)", async () => {
    const stop = startGrantSync();
    await flush();
    useBrowserApprovalStore.getState().requestApproval("r3", "https://a.com", "click");
    invoke.mockClear();
    useBrowserApprovalStore.getState().resolveApproval("r3", "remember");
    await flush();

    expect(invoke).not.toHaveBeenCalledWith("browser_add_one_shot", expect.anything());
    expect(invoke).toHaveBeenCalledWith("browser_set_grants", expect.anything());
    stop();
  });
});

// Grant pushes are the AUTHORITY's view of policy. Tauri does not guarantee that
// two concurrently-dispatched commands complete in call order, so a fire-and-forget
// push could let an older grant snapshot land AFTER a newer revocation — the driver
// would then honor a grant the user already revoked. Pushes must be serialized.
describe("grant-sync ordering and fail-closed retry", () => {
  it("serializes pushes: a later change is not sent until the in-flight push settles", async () => {
    const resolvers: Array<() => void> = [];
    invoke.mockImplementation(() => new Promise<void>((resolve) => resolvers.push(() => resolve())));

    const stop = startGrantSync(); // start push (empty grants) → invoke #1, left pending
    expect(invoke).toHaveBeenCalledTimes(1);

    // Two rapid changes while the start push is still in flight.
    useBrowserApprovalStore.getState().grant("https://a.com", ["click"]);
    useBrowserApprovalStore.getState().grant("https://b.com", ["read"]);

    // Neither has been sent — the syncer waited for the in-flight push.
    expect(invoke).toHaveBeenCalledTimes(1);

    // The start push settles → exactly one more push carrying the LATEST state,
    // coalescing the intermediate [a.com] snapshot away.
    resolvers[0]();
    await Promise.resolve();
    await Promise.resolve();

    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith("browser_set_grants", {
      grants: [
        { originPattern: "https://a.com", operations: ["click"] },
        { originPattern: "https://b.com", operations: ["read"] },
      ],
    });
    resolvers[1]?.();
    stop();
  });

  it("retries a failed grant sync rather than silently abandoning it (fail-closed)", async () => {
    let calls = 0;
    invoke.mockImplementation(() => {
      calls += 1;
      return Promise.reject(new Error("driver down"));
    });

    const stop = startGrantSync();
    // Let the bounded retries flush.
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    stop();

    // A single one-and-done push would leave the driver on stale (permissive) state
    // after a revocation. The syncer retries before giving up.
    expect(calls).toBeGreaterThan(1);
  });
});
