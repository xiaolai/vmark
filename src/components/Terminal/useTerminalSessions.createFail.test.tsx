// Audit 20260831 #38 — a createTerminalInstance throw (WebGL exhaustion,
// disposed parent) must not leave the store session alive: nothing ever
// registers an entry for it, so the tab rendered forever-blank and neither
// fit nor restart could reach it. The failed session is removed instead.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("./createTerminalInstance", () => ({
  createTerminalInstance: vi.fn(() => {
    throw new Error("boom: WebGL context exhausted");
  }),
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useTerminalSessions } from "./useTerminalSessions";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";

describe("useTerminalSessions — instance construction failure (audit #38)", () => {
  beforeEach(() => {
    resetTerminalSessionStore();
  });

  it("removes the store session when the xterm factory throws", () => {
    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSessions(containerRef));

    act(() => {
      useUIStore.getState().terminalCreateSession();
    });

    // The old behavior: session survives with no instance — a permanently
    // blank, unrecoverable tab.
    expect(useUIStore.getState().terminal.sessions).toHaveLength(0);
    expect(useUIStore.getState().terminal.activeSessionId).toBeNull();
  });
});
