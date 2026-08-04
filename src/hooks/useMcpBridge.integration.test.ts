// WI-10 — useMcpBridge wiring-hook matrix: the ONE hook left in hooks/ after
// the mcpBridge→services migration, proven against the REAL service pipeline.
//
// Unlike useMcpBridge.test.ts (which pins the hook's own parsing/dedup
// contract with handleRequest mocked), this file mocks ONLY the
// `@tauri-apps/*` boundary: a delivered bridge event flows through the real
// handleRequest → dispatchV2 → handleWorkspaceSwitchTab → real tabStore, and
// the assertions land on store state (Level 4) plus the outbound
// `mcp_bridge_respond` payload — never on "listen was called".
//
//   - mount → deliver → real service processes it (observable state change)
//   - unmount → the same-shaped event produces NO further state change
//   - StrictMode double-mount → one event is handled exactly once
//
// @coordinates-with services/mcpBridge/handleRequest.ts — the real route taken
// @coordinates-with services/mcpBridge/v2/workspace.ts — switch_tab handler

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StrictMode, createElement, type ReactNode } from "react";

type BridgeHandler = (event: { payload: unknown }) => void;

const { listeners, invokeCalls } = vi.hoisted(() => ({
  listeners: new Set<BridgeHandler>(),
  invokeCalls: [] as Array<{ cmd: string; args: unknown }>,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, handler: BridgeHandler) => {
    listeners.add(handler);
    return Promise.resolve(() => listeners.delete(handler));
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: unknown) => {
    invokeCalls.push({ cmd, args });
    return undefined;
  },
}));

import { useMcpBridge } from "./useMcpBridge";
import { useTabStore } from "@/stores/tabStore";
import { resetRequestDedup } from "@/services/mcpBridge/requestDedup";

/** Outbound bridge responses, in send order. */
function respondPayloads(): Array<{ id: string; success: boolean; data?: unknown }> {
  return invokeCalls
    .filter((c) => c.cmd === "mcp_bridge_respond")
    .map((c) => (c.args as { payload: { id: string; success: boolean; data?: unknown } }).payload);
}

/** Deliver one bridge event to every registered listener (the Rust emit). */
function deliver(payload: unknown): void {
  for (const handler of [...listeners]) handler({ payload });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function seedTwoTabs(): void {
  useTabStore.setState({
    tabs: {
      main: [
        { id: "tab-a", filePath: null, title: "A", isPinned: false },
        { id: "tab-b", filePath: null, title: "B", isPinned: false },
      ],
    },
    activeTabId: { main: "tab-a" },
    untitledCounter: 0,
    closedTabs: {},
  });
}

function switchTabEvent(id: string, tabId: string) {
  return { id, type: "vmark.workspace.switch_tab", args_json: JSON.stringify({ tabId }) };
}

beforeEach(() => {
  listeners.clear();
  invokeCalls.length = 0;
  resetRequestDedup();
  seedTwoTabs();
});

describe("useMcpBridge — real-pipeline wiring (WI-10 matrix)", () => {
  it("mount → delivered event drives the REAL service: tabStore state changes", async () => {
    renderHook(() => useMcpBridge());
    await flushMicrotasks();

    deliver(switchTabEvent("wi10-real-1", "tab-b"));
    await flushMicrotasks();

    // Level 4: the real handler chain moved real store state.
    expect(useTabStore.getState().activeTabId.main).toBe("tab-b");
    // And the real respond() answered over the bridge with the new state.
    const replies = respondPayloads().filter((p) => p.id === "wi10-real-1");
    expect(replies).toHaveLength(1);
    expect(replies[0].success).toBe(true);
    expect(replies[0].data).toMatchObject({ activated: true, activeTabId: "tab-b" });
  });

  it("unmount → the same event shape produces NO further state change", async () => {
    const { unmount } = renderHook(() => useMcpBridge());
    await flushMicrotasks();
    unmount();

    // The unlisten actually removed the handler — nothing is registered.
    expect(listeners.size).toBe(0);

    deliver(switchTabEvent("wi10-after-unmount", "tab-b"));
    await flushMicrotasks();

    expect(useTabStore.getState().activeTabId.main).toBe("tab-a");
    expect(respondPayloads()).toHaveLength(0);
  });

  it("StrictMode double-mount → one delivered event is handled exactly once", async () => {
    renderHook(() => useMcpBridge(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(StrictMode, null, children),
    });
    await flushMicrotasks();

    // The first (thrown-away) mount's listener was cleaned up; one remains.
    expect(listeners.size).toBe(1);

    deliver(switchTabEvent("wi10-strict", "tab-b"));
    await flushMicrotasks();

    expect(useTabStore.getState().activeTabId.main).toBe("tab-b");
    // Exactly one execution → exactly one bridge reply for this id.
    expect(respondPayloads().filter((p) => p.id === "wi10-strict")).toHaveLength(1);
  });
});
