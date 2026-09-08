// @vitest-environment node
// Round 3 (#148) — the runtime services a window starts are one list with one
// disposer: every service is started exactly once and stopped exactly once, in
// reverse order, even when one disposer throws.
import { describe, expect, it, vi } from "vitest";

const { order, service } = vi.hoisted(() => {
  const order: string[] = [];
  const service = (name: string) =>
    vi.fn(() => {
      order.push(`start:${name}`);
      return () => {
        order.push(`stop:${name}`);
      };
    });
  return { order, service };
});
vi.mock("@/services/browser/grantSync", () => ({ startGrantSync: service("grants") }));
vi.mock("@/services/browser/browserLeaseWiring", () => ({ startBrowserLeaseWiring: service("lease") }));
vi.mock("@/services/browser/browserTabEvents", () => ({ startBrowserTabEvents: service("tabEvents") }));
vi.mock("@/services/browser/browserTabLifecycle", () => ({ startBrowserTabLifecycle: service("lifecycle") }));
vi.mock("@/services/browser/recorderWiring", () => ({ startRecorderWiring: service("recorder") }));
vi.mock("@/services/coherence/scanOnChange", () => ({ startCoherenceScanOnChange: service("coherence") }));
vi.mock("@/services/mcpBridge/windowWorkspaceSync", () => ({ startWindowWorkspaceSync: service("workspace") }));
vi.mock("@/services/browser/browserAiPolicySync", () => ({ startBrowserAiPolicySync: service("aiPolicy") }));
vi.mock("@/services/workflow/workflowEnginePolicySync", () => ({ startWorkflowEnginePolicySync: service("engine") }));
vi.mock("@/services/browser/browserMenuSync", () => ({ startBrowserMenuSync: service("menu") }));
vi.mock("@/utils/debug", () => ({ appError: vi.fn() }));

import { startRuntimeServices } from "./runtimeWiring";
import { startBrowserTabEvents } from "@/services/browser/browserTabEvents";
import { startBrowserMenuSync } from "@/services/browser/browserMenuSync";
import { startBrowserLeaseWiring } from "@/services/browser/browserLeaseWiring";
import { appError } from "@/utils/debug";

describe("startRuntimeServices", () => {
  it("starts every service once and the disposer stops each once, in reverse order", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    const starts = order.filter((e) => e.startsWith("start:"));
    expect(starts).toHaveLength(10);
    expect(new Set(starts).size).toBe(10);
    expect(starts[0]).toBe("start:grants");
    stop();
    const stops = order.filter((e) => e.startsWith("stop:"));
    expect(stops).toHaveLength(10);
    expect(stops[0]).toBe("stop:menu");
    expect(stops.at(-1)).toBe("stop:grants");
  });

  // Audit #358 — startup is transactional: a service that throws while
  // starting must not leave the ones started before it running with no
  // disposer anywhere. They are stopped in reverse order and the error
  // propagates unchanged.
  it("a service that throws on start stops the ones already started, in reverse order, and rethrows", () => {
    order.length = 0;
    vi.mocked(startBrowserTabEvents).mockImplementationOnce(() => {
      order.push("start:tabEvents");
      throw new Error("tab events boom");
    });
    expect(() => startRuntimeServices()).toThrow("tab events boom");
    expect(order).toEqual([
      "start:grants",
      "start:lease",
      "start:tabEvents",
      "stop:lease",
      "stop:grants",
    ]);
  });

  // Audit #987 — cleanup is a SWEEP, not a chain. A disposer that threw aborted
  // every disposer after it, leaking exactly the services the teardown existed
  // to stop.
  it("one disposer that throws does not stop the others from running", () => {
    order.length = 0;
    vi.mocked(startBrowserMenuSync).mockImplementationOnce(() => {
      order.push("start:menu");
      return () => {
        order.push("stop:menu");
        throw new Error("menu disposer boom");
      };
    });
    const stop = startRuntimeServices();
    expect(() => stop()).not.toThrow();
    const stops = order.filter((e) => e.startsWith("stop:"));
    expect(stops).toHaveLength(10);
    expect(stops.at(-1)).toBe("stop:grants");
    expect(vi.mocked(appError)).toHaveBeenCalled();
  });

  // …and on the ROLLBACK path the startup error is what the caller must see.
  // A throwing disposer used to replace it, so the failure that actually
  // mattered never reached anyone.
  it("a throwing disposer during rollback preserves the startup error", () => {
    order.length = 0;
    vi.mocked(startBrowserTabEvents).mockImplementationOnce(() => {
      order.push("start:tabEvents");
      throw new Error("tab events boom");
    });
    // The lease disposer, which the rollback reaches first, also throws.
    vi.mocked(startBrowserLeaseWiring).mockImplementationOnce(() => {
      order.push("start:lease");
      return () => {
        order.push("stop:lease");
        throw new Error("lease disposer boom");
      };
    });

    expect(() => startRuntimeServices()).toThrow("tab events boom");
    // …and the disposer after it still ran.
    expect(order).toContain("stop:grants");
  });
});
