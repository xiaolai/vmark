/**
 * Tests for useCommandBootstrap — the single wiring point for every
 * command-group registration plus the Tauri menu→command bridge.
 *
 * Critical paths locked here:
 *  - mountMenuCommands rejection is swallowed (audit H6) — a thrown bridge
 *    setup must NOT bubble to React or leave an unhandled promise. Without
 *    the guard, every menu item, accelerator, and palette entry stops
 *    routing with no user-visible error.
 *  - registerPandocFormatCommands rejection is swallowed independently
 *    (pre-existing guard).
 *  - Unmount before mountMenuCommands resolves invokes the returned
 *    unlistener so listeners do not leak.
 *  - Normal mount calls mountMenuCommands with the bundled bindings and
 *    retains the unlistener for the cleanup phase.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const mountMenuCommandsMock = vi.fn();
const registerPandocMock = vi.fn();
const menuErrorMock = vi.fn();
const registerMisc = vi.fn();
const registerExport = vi.fn();
const registerWorkspace = vi.fn();
const registerRecentFiles = vi.fn();
const registerRecentWorkspaces = vi.fn();
const registerView = vi.fn();
const registerFormat = vi.fn();
const disposeEditor = vi.fn();
const registerEditor = vi.fn(() => disposeEditor);
const stopRuntime = vi.fn();
const startRuntime = vi.fn(() => stopRuntime);

vi.mock("@/services/commands/menuListener", () => ({
  mountMenuCommands: (...args: unknown[]) => mountMenuCommandsMock(...args),
}));
vi.mock("@/services/commands/exportCommands", () => ({
  registerExportCommands: () => registerExport(),
  registerPandocFormatCommands: () => registerPandocMock(),
}));
vi.mock("@/services/commands/miscCommands", () => ({ registerMiscCommands: () => registerMisc() }));
vi.mock("@/services/commands/workspaceCommands", () => ({
  registerWorkspaceCommands: () => registerWorkspace(),
}));
vi.mock("@/services/commands/recentFilesCommands", () => ({
  registerRecentFilesCommands: () => registerRecentFiles(),
}));
vi.mock("@/services/commands/recentWorkspacesCommands", () => ({
  registerRecentWorkspacesCommands: () => registerRecentWorkspaces(),
}));
vi.mock("@/services/commands/viewCommands", () => ({ registerViewCommands: () => registerView() }));
vi.mock("@/services/commands/formatCommands", () => ({
  registerFormatCommands: () => registerFormat(),
}));
vi.mock("@/services/commands/editorCommandBridge", () => ({ registerEditorCommands: () => registerEditor() }));
vi.mock("@/services/runtimeWiring", () => ({ startRuntimeServices: () => startRuntime() }));
vi.mock("@/utils/debug", () => ({ menuError: (...args: unknown[]) => menuErrorMock(...args), appError: vi.fn(), browserWarn: vi.fn() }));
const signalMenuReady = vi.fn();
vi.mock("@/services/commands/menuCommandsReady", () => ({
  signalMenuCommandsMounted: (...args: unknown[]) => signalMenuReady(...args),
}));

/** The shape mountMenuCommands resolves with (audit #359): teardown + completeness. */
type MountResult = { off: () => void; failed: string[] };

import { useCommandBootstrap } from "./useCommandBootstrap";
import { useRecentWorkspacesStore } from "@/stores/recentsStore";

beforeEach(() => {
  mountMenuCommandsMock.mockReset();
  registerPandocMock.mockReset();
  menuErrorMock.mockReset();
  registerMisc.mockReset();
  registerExport.mockReset();
  registerWorkspace.mockReset();
  registerRecentFiles.mockReset();
  registerRecentWorkspaces.mockReset();
  registerView.mockReset();
  registerFormat.mockReset();
  registerEditor.mockClear();
  disposeEditor.mockClear();
  startRuntime.mockClear();
  stopRuntime.mockClear();
  signalMenuReady.mockReset();

  // Default happy-path behaviors — individual tests override as needed.
  registerPandocMock.mockResolvedValue([]);
  mountMenuCommandsMock.mockResolvedValue({ off: () => {}, failed: [] });
});

describe("useCommandBootstrap", () => {
  it("registers every command group synchronously on mount", () => {
    renderHook(() => useCommandBootstrap());
    expect(registerMisc).toHaveBeenCalledTimes(1);
    expect(registerExport).toHaveBeenCalledTimes(1);
    expect(registerWorkspace).toHaveBeenCalledTimes(1);
    expect(registerRecentFiles).toHaveBeenCalledTimes(1);
    expect(registerRecentWorkspaces).toHaveBeenCalledTimes(1);
    expect(registerView).toHaveBeenCalledTimes(1);
    expect(registerFormat).toHaveBeenCalledTimes(1);
    expect(registerEditor).toHaveBeenCalledTimes(1);
  });

  it("disposes the editor-command batch when the hook unmounts", () => {
    const { unmount } = renderHook(() => useCommandBootstrap());
    expect(disposeEditor).not.toHaveBeenCalled();
    unmount();
    expect(disposeEditor).toHaveBeenCalledTimes(1);
  });

  it("stops the runtime services when the hook unmounts", () => {
    const { unmount } = renderHook(() => useCommandBootstrap());
    expect(startRuntime).toHaveBeenCalledTimes(1);
    expect(stopRuntime).not.toHaveBeenCalled();
    unmount();
    expect(stopRuntime).toHaveBeenCalledTimes(1);
  });

  // Audit #358 — startup is transactional. The editor-command batch is the one
  // registration that owns resources; when the runtime services fail to start
  // the effect never returns its cleanup, so the batch must be disposed HERE or
  // it stays registered in a window that has no working services. The error
  // itself still propagates — a window without its services is not a working
  // window, and hiding that would be worse than the crash.
  it("disposes the editor-command batch when the runtime services fail to start, and rethrows", () => {
    startRuntime.mockImplementationOnce(() => {
      throw new Error("service boom");
    });
    expect(() => renderHook(() => useCommandBootstrap())).toThrow("service boom");
    expect(disposeEditor).toHaveBeenCalledTimes(1);
    expect(mountMenuCommandsMock).not.toHaveBeenCalled();
  });

  it("calls mountMenuCommands with the bundled bindings", async () => {
    renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    expect(mountMenuCommandsMock).toHaveBeenCalledTimes(1);
    const bindings = mountMenuCommandsMock.mock.calls[0][0];
    // Sanity-check the bundle: at minimum it must carry the misc + view
    // bindings (the largest two groups).
    expect(bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ commandId: "app.preferences" }),
      expect.objectContaining({ commandId: "view.toggleSourceMode" }),
    ]));
  });

  it("swallows a registerPandocFormatCommands rejection (existing guard)", async () => {
    registerPandocMock.mockRejectedValueOnce(new Error("pandoc boom"));
    renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(menuErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Pandoc"),
      expect.any(Error),
    );
    // Bridge mount still proceeds.
    expect(mountMenuCommandsMock).toHaveBeenCalled();
    // …but the menu is INCOMPLETE (audit #712): every Pandoc export item is
    // now a native menu entry routing to a command that was never registered,
    // which is the same defect as a binding that could not listen. Announcing
    // `true` over it is exactly the "menu that routes nowhere" the readiness
    // signal exists to prevent.
    expect(signalMenuReady).toHaveBeenCalledWith(false);
  });

  it("swallows a mountMenuCommands rejection without bubbling (audit H6)", async () => {
    mountMenuCommandsMock.mockRejectedValueOnce(new Error("bridge dead"));
    const unhandled = vi.fn();
    const onRej = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      unhandled(e.reason);
    };
    window.addEventListener("unhandledrejection", onRej);

    expect(() => renderHook(() => useCommandBootstrap())).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(menuErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to mount menu commands"),
      expect.any(Error),
    );
    expect(unhandled).not.toHaveBeenCalled();
    window.removeEventListener("unhandledrejection", onRej);
  });

  // Audit #359 (round 3). Round 2 signalled readiness from a `finally`, so a
  // mount that REJECTED still announced the menu as ready — and because the
  // mount had also become all-or-nothing, one bad listener left the window with
  // no menu at all while claiming a working one. Both halves are pinned here.
  it("signals NOT-mounted when the whole mount rejects", async () => {
    mountMenuCommandsMock.mockRejectedValueOnce(new Error("bridge dead"));
    renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(signalMenuReady).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("signals NOT-mounted when some bindings could not listen, and keeps the rest", async () => {
    const off = vi.fn();
    mountMenuCommandsMock.mockResolvedValueOnce({ off, failed: ["menu:save"] });
    const { unmount } = renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(signalMenuReady).toHaveBeenCalledExactlyOnceWith(false);
    // The partial mount is RETAINED — the user keeps every menu item that did
    // bind — and its teardown still runs on unmount.
    expect(menuErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("could not mount"),
      ["menu:save"],
    );
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("invokes the unlistener when the hook unmounts after a normal mount", async () => {
    const off = vi.fn();
    mountMenuCommandsMock.mockResolvedValueOnce({ off, failed: [] });
    const { unmount } = renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("a StrictMode-cancelled first pass never trips the menu-ready barrier; the live pass does, once (round 3, #272)", async () => {
    let resolveFirst: ((result: MountResult) => void) | null = null;
    mountMenuCommandsMock.mockImplementationOnce(
      () => new Promise<MountResult>((resolve) => (resolveFirst = resolve)),
    );
    const { unmount } = renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    unmount(); // the cancelled pass
    expect(resolveFirst).not.toBeNull();
    resolveFirst!({ off: () => {}, failed: [] });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(signalMenuReady).not.toHaveBeenCalled();

    // The replayed (live) pass mounts and signals exactly once.
    mountMenuCommandsMock.mockResolvedValueOnce({ off: () => {}, failed: [] });
    renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(signalMenuReady).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("invokes the unlistener when unmount races mountMenuCommands resolution (audit Round A H4)", async () => {
    const off = vi.fn();
    // Capture the resolver so we can defer resolution past unmount.
    let resolveOff: ((result: MountResult) => void) | null = null;
    mountMenuCommandsMock.mockImplementationOnce(
      () =>
        new Promise<MountResult>((resolve) => {
          resolveOff = resolve;
        }),
    );

    const { unmount } = renderHook(() => useCommandBootstrap());
    // Wait one microtask so the effect's async IIFE has started awaiting
    // mountMenuCommands before we unmount.
    await Promise.resolve();
    unmount();

    // Now resolve the deferred promise. Inside the IIFE: `cancelled` is
    // true → `off()` is called to avoid a listener leak.
    expect(resolveOff).not.toBeNull();
    resolveOff!({ off, failed: [] });
    // Flush the awaited continuation and the synchronous off() call.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(off).toHaveBeenCalledTimes(1);
  });
});


describe("DEV seam: forgetRecentWorkspace", () => {
  it("removes a workspace from the recents through the store's own action", () => {
    const path = "/tmp/vmark-e2e-second-window-seam";
    useRecentWorkspacesStore.getState().addWorkspace(path);
    expect(useRecentWorkspacesStore.getState().workspaces.some((w) => w.path === path)).toBe(true);
    renderHook(() => useCommandBootstrap());
    const seam = (window as unknown as { __VMARK_DEBUG__?: Record<string, unknown> }).__VMARK_DEBUG__;
    const forget = seam?.forgetRecentWorkspace as ((p: string) => void) | undefined;
    expect(typeof forget).toBe("function");
    forget?.(path);
    expect(useRecentWorkspacesStore.getState().workspaces.some((w) => w.path === path)).toBe(false);
  });
});
