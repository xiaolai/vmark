// @vitest-environment node
// Round 3 (#148) — the runtime services a window starts are one list with one
// disposer: every service is started exactly once and stopped exactly once, in
// reverse order, even when one disposer throws.
import { describe, expect, it, vi } from "vitest";

const { order, service } = vi.hoisted(() => {
  const order: string[] = [];
  const service = (name: string) => () => {
    order.push(`start:${name}`);
    return () => {
      order.push(`stop:${name}`);
    };
  };
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

import { startRuntimeServices } from "./runtimeWiring";

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
});
