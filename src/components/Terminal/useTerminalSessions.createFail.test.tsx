// Audit 20260831 #38 — a createTerminalInstance throw (an xterm call failing
// on a disposed parent) must not leave the store session alive: nothing ever
// registers an entry for it, so the tab rendered forever-blank and neither
// fit nor restart could reach it. The failed session is removed instead.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// The real createTerminalInstance runs; the fault is at the xterm boundary —
// opening the terminal into its container throws, as it does for a disposed
// parent.
const xterm = vi.hoisted(() => ({ opens: 0, disposes: 0 }));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    parser = { registerOscHandler: vi.fn(), registerEscHandler: vi.fn(() => ({ dispose: vi.fn() })), registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })) };
    // Floating-prompt subscriptions (setupFloatingPrompt).
    onScroll = vi.fn(() => ({ dispose: vi.fn() }));
    onWriteParsed = vi.fn(() => ({ dispose: vi.fn() }));
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onCursorMove = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    scrollToBottom = vi.fn();
    unicode = { activeVersion: "6" };
    loadAddon = vi.fn();
    open = vi.fn(() => {
      xterm.opens += 1;
      throw new Error("boom: terminal parent was disposed");
    });
    dispose = vi.fn(() => {
      xterm.disposes += 1;
    });
  },
}));
// Constructed before open(); the shared setup's arrow-function fakes cannot
// be called with `new`.
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit = vi.fn(); } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useTerminalSessions } from "./useTerminalSessions";
import { resetTerminalSessionStore, useTerminalStore } from "@/stores/terminalStore";

describe("useTerminalSessions — instance construction failure (audit #38)", () => {
  beforeEach(() => {
    resetTerminalSessionStore();
    xterm.opens = 0;
    xterm.disposes = 0;
  });

  it("removes the store session when the xterm factory throws", () => {
    const containerRef = { current: document.createElement("div") };
    renderHook(() => useTerminalSessions(containerRef));

    act(() => {
      useTerminalStore.getState().terminalCreateSession();
    });

    // The old behavior: session survives with no instance — a permanently
    // blank, unrecoverable tab.
    expect(xterm.opens).toBe(1);
    expect(useTerminalStore.getState().sessions).toHaveLength(0);
    expect(useTerminalStore.getState().activeSessionId).toBeNull();
    // The half-built terminal was rolled back, not leaked, and its container
    // left the DOM.
    expect(xterm.disposes).toBe(1);
    expect(containerRef.current.children).toHaveLength(0);
  });
});
