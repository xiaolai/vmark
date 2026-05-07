// WI-1B.7 — behavioral test for the recent-files menu event hook.
//
// The audit caught a regression where the "Open Recent" path bypassed
// routeOpenBySize / forced-source marking / the progress indicator.
// This test renders the hook with a stubbed Tauri webview window,
// captures the registered `listen()` callback for `menu:open-recent-file`,
// invokes it, and asserts the create_tab branch routes through
// openFileInNewTabCore (the shared open core that already enforces the
// size gate, forced-source marking, and progress indicator).

import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock setup — vi.mock() is hoisted; capture handles via vi.hoisted().
const hoisted = vi.hoisted(() => {
  const listenCallbacks = new Map<string, (event: { payload: unknown }) => void>();
  const openFileInNewTabCore = vi.fn();
  const routeOpenBySize = vi.fn();
  const setActiveTab = vi.fn();
  return { listenCallbacks, openFileInNewTabCore, routeOpenBySize, setActiveTab };
});

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: vi.fn(async (eventName: string, cb: (e: { payload: unknown }) => void) => {
      hoisted.listenCallbacks.set(eventName, cb);
      // Tauri's listen() resolves to an unlisten fn; return a no-op.
      return () => undefined;
    }),
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  ask: vi.fn().mockResolvedValue(false),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@/hooks/useFileOpen", () => ({
  openFileInNewTabCore: hoisted.openFileInNewTabCore,
}));

vi.mock("@/utils/largeFileRouting", () => ({
  routeOpenBySize: hoisted.routeOpenBySize,
}));

vi.mock("@/stores/recentFilesStore", () => ({
  useRecentFilesStore: {
    getState: () => ({
      files: [{ path: "/tmp/recent.md" }],
      addFile: vi.fn(),
      removeFile: vi.fn(),
      clearAll: vi.fn(),
    }),
  },
}));

vi.mock("@/stores/tabStore", () => ({
  useTabStore: {
    getState: () => ({
      findTabByPath: () => null,
      setActiveTab: hoisted.setActiveTab,
    }),
  },
}));

vi.mock("@/stores/workspaceStore", () => ({
  useWorkspaceStore: {
    getState: () => ({ isWorkspaceMode: false, rootPath: null }),
  },
}));

vi.mock("@/utils/reentryGuard", () => ({
  withReentryGuard: async (
    _label: string,
    _key: string,
    fn: () => Promise<void>,
  ) => {
    await fn();
  },
}));

vi.mock("@/utils/openPolicy", () => ({
  resolveOpenAction: ({ filePath }: { filePath: string }) => ({
    action: "create_tab",
    filePath,
  }),
}));

vi.mock("@/hooks/useReplaceableTab", () => ({
  getReplaceableTab: () => null,
}));

vi.mock("@/hooks/openWorkspaceWithConfig", () => ({
  openWorkspaceWithConfig: vi.fn(),
}));

vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAll: () => [],
}));

vi.mock("@/utils/imeToast", () => ({
  imeToast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

vi.mock("@/i18n", () => ({
  default: { t: (k: string) => k },
}));

describe("useRecentFilesMenuEvents", () => {
  beforeEach(() => {
    hoisted.listenCallbacks.clear();
    hoisted.openFileInNewTabCore.mockReset();
    hoisted.routeOpenBySize.mockReset();
    hoisted.setActiveTab.mockReset();
  });

  it("module exports the registration hook", async () => {
    const mod = await import("./useRecentFilesMenuEvents");
    expect(typeof mod.useRecentFilesMenuEvents).toBe("function");
  });

  it("registers a listener for menu:open-recent-file", async () => {
    const { useRecentFilesMenuEvents } = await import("./useRecentFilesMenuEvents");
    renderHook(() => useRecentFilesMenuEvents());
    // Tauri's listen is async — give the microtask queue a chance.
    await new Promise((r) => setTimeout(r, 0));
    expect(hoisted.listenCallbacks.has("menu:open-recent-file")).toBe(true);
    expect(hoisted.listenCallbacks.has("menu:clear-recent")).toBe(true);
  });

  it("create_tab branch routes through openFileInNewTabCore (size-gating regression)", async () => {
    // The audit caught that an earlier implementation bypassed
    // routeOpenBySize / forced-source / progress for huge files. Pin the
    // contract: when the policy decides create_tab, the hook MUST delegate
    // to the shared open core — never read+initDocument directly.
    hoisted.openFileInNewTabCore.mockResolvedValueOnce(undefined);
    const { useRecentFilesMenuEvents } = await import("./useRecentFilesMenuEvents");
    renderHook(() => useRecentFilesMenuEvents());
    await new Promise((r) => setTimeout(r, 0));

    const callback = hoisted.listenCallbacks.get("menu:open-recent-file");
    expect(callback).toBeDefined();

    await callback!({ payload: ["/tmp/recent.md", "main"] });
    // Drain pending microtasks (withReentryGuard + async).
    await new Promise((r) => setTimeout(r, 0));

    expect(hoisted.openFileInNewTabCore).toHaveBeenCalledWith(
      "main",
      "/tmp/recent.md",
    );
  });

  it("ignores events targeted at a different window", async () => {
    const { useRecentFilesMenuEvents } = await import("./useRecentFilesMenuEvents");
    renderHook(() => useRecentFilesMenuEvents());
    await new Promise((r) => setTimeout(r, 0));

    const callback = hoisted.listenCallbacks.get("menu:open-recent-file");
    await callback!({ payload: ["/tmp/recent.md", "doc-2"] });
    await new Promise((r) => setTimeout(r, 0));

    expect(hoisted.openFileInNewTabCore).not.toHaveBeenCalled();
  });
});
