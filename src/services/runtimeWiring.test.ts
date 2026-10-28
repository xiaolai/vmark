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
vi.mock("@/services/mcpBridge/windowTabsSync", () => ({ startWindowTabsSync: service("windowTabs") }));
vi.mock("@/services/browser/browserAiPolicySync", () => ({ startBrowserAiPolicySync: service("aiPolicy") }));
vi.mock("@/services/workflow/workflowEnginePolicySync", () => ({ startWorkflowEnginePolicySync: service("engine") }));
vi.mock("@/services/menu/conditionalMenuItemSync", () => ({
  startConditionalMenuItemSync: service("menu"),
}));
vi.mock("@/services/windowClose/tabCleanup", () => ({
  startTabStateCleanup: service("tabCleanup"),
}));
vi.mock("@/services/agentJournal/provenanceSessions", () => ({
  startProvenanceSessions: service("provenance"),
}));
vi.mock("@/services/agentJournal/recordingReport", () => ({
  startRecordingLifetimes: service("recordingLifetimes"),
}));
vi.mock("@/utils/debug", () => ({ appError: vi.fn() }));

import { startRuntimeServices } from "./runtimeWiring";
import { startBrowserTabEvents } from "@/services/browser/browserTabEvents";
import { startConditionalMenuItemSync } from "@/services/menu/conditionalMenuItemSync";
import { startBrowserLeaseWiring } from "@/services/browser/browserLeaseWiring";
import { appError } from "@/utils/debug";

describe("startRuntimeServices", () => {
  it("starts every service once and the disposer stops each once, in reverse order", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    const starts = order.filter((e) => e.startsWith("start:"));
    expect(starts).toHaveLength(14);
    expect(new Set(starts).size).toBe(14);
    expect(starts[0]).toBe("start:grants");
    stop();
    const stops = order.filter((e) => e.startsWith("stop:"));
    expect(stops).toHaveLength(14);
    expect(stops[0]).toBe("stop:tabCleanup");
    expect(stops.at(-1)).toBe("stop:grants");
  });

  // WI-RA1B.1 — per-tab state cleanup is a consequence of tab removal only
  // while this subscriber runs. A window that does not start it leaves every
  // closed tab's document behind, silently.
  // WI-AL1.4 — without the provenance sessions no editor edit is ever
  // certified: every save and controlled write would be a snapshotOnly barrier.
  it("starts the provenance sessions with the window", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    expect(order).toContain("start:provenance");
    stop();
    expect(order).toContain("stop:provenance");
  });

  // WI-AL1.7 — without it a closed document's "history not recorded" entry
  // is never retired, so the store grows with every document ever reported.
  it("starts the recording lifetimes with the window", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    expect(order).toContain("start:recordingLifetimes");
    stop();
    expect(order).toContain("stop:recordingLifetimes");
  });

  // A request naming a tab routes to the window holding it only while each
  // window publishes its tabs to the bridge.
  it("publishes the window's tabs to the bridge for its lifetime", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    expect(order).toContain("start:windowTabs");
    stop();
    expect(order).toContain("stop:windowTabs");
  });

  it("starts the tab-state cleanup with the window", () => {
    order.length = 0;
    const stop = startRuntimeServices();
    expect(order).toContain("start:tabCleanup");
    stop();
    expect(order).toContain("stop:tabCleanup");
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
    vi.mocked(startConditionalMenuItemSync).mockImplementationOnce(() => {
      order.push("start:menu");
      return () => {
        order.push("stop:menu");
        throw new Error("menu disposer boom");
      };
    });
    const stop = startRuntimeServices();
    expect(() => stop()).not.toThrow();
    const stops = order.filter((e) => e.startsWith("stop:"));
    expect(stops).toHaveLength(14);
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
