// #1070 — useViewMenuStateSync pushes the View editor-mode menu state to Rust.
// Verifies the invoke contract (command + arg keys) and the flag→state mapping.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

const invokeMock = vi.fn(() => Promise.resolve());
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
  }),
}));
vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));

import { useUIStore } from "@/stores/uiStore";
import { useTabStore } from "@/stores/tabStore";
import { useLargeFileSessionStore } from "@/stores/documentStore";
import { useViewMenuStateSync } from "./useViewMenuStateSync";

function seedTab(formatId: string) {
  useTabStore.setState({
    tabs: { main: [{ id: "t1", title: "t", isPinned: false, formatId } as never] },
    activeTabId: { main: "t1" },
  } as never);
}

function lastInvokeArgs() {
  const calls = invokeMock.mock.calls.filter((c) => c[0] === "sync_view_menu_state");
  return calls.length ? (calls[calls.length - 1][1] as Record<string, unknown>) : null;
}

beforeEach(() => {
  vi.useFakeTimers();
  invokeMock.mockClear();
  useUIStore.setState({ sourceMode: false, markdownSplitView: false } as never);
  useLargeFileSessionStore.setState({ forcedSourceTabs: {} } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useViewMenuStateSync", () => {
  it("pins the invoke contract: command name + arg keys", () => {
    seedTab("markdown");
    renderHook(() => useViewMenuStateSync());
    vi.advanceTimersByTime(60);

    const calls = invokeMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toBe("sync_view_menu_state");
    expect(Object.keys(calls[0][1] as object).sort()).toEqual([
      "lineNumbersApplies",
      "mode",
      "modeApplies",
      "wordWrapApplies",
    ]);
  });

  it("markdown WYSIWYG → word wrap disabled, line numbers still enabled (ADR-5)", () => {
    seedTab("markdown");
    renderHook(() => useViewMenuStateSync());
    vi.advanceTimersByTime(60);
    expect(lastInvokeArgs()).toEqual({
      mode: "wysiwyg",
      modeApplies: true,
      wordWrapApplies: false,
      lineNumbersApplies: true,
    });
  });

  it("markdown Source → modes apply, both toggles enabled", () => {
    useUIStore.setState({ sourceMode: true, markdownSplitView: false } as never);
    seedTab("markdown");
    renderHook(() => useViewMenuStateSync());
    vi.advanceTimersByTime(60);
    expect(lastInvokeArgs()).toEqual({
      mode: "source",
      modeApplies: true,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("forced-source large file → reads as Source even with WYSIWYG flags", () => {
    seedTab("markdown");
    useLargeFileSessionStore.setState({ forcedSourceTabs: { t1: true } } as never);
    renderHook(() => useViewMenuStateSync());
    vi.advanceTimersByTime(60);
    expect(lastInvokeArgs()).toEqual({
      mode: "source",
      modeApplies: true,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });

  it("non-markdown tab → modes do not apply, toggles enabled (CodeMirror)", () => {
    seedTab("json");
    renderHook(() => useViewMenuStateSync());
    vi.advanceTimersByTime(60);
    expect(lastInvokeArgs()).toEqual({
      mode: "wysiwyg",
      modeApplies: false,
      wordWrapApplies: true,
      lineNumbersApplies: true,
    });
  });
});
