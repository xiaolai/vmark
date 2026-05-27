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

vi.mock("./menuListener", () => ({
  mountMenuCommands: (...args: unknown[]) => mountMenuCommandsMock(...args),
}));
vi.mock("./exportCommands", () => ({
  registerExportCommands: () => registerExport(),
  registerPandocFormatCommands: () => registerPandocMock(),
}));
vi.mock("./miscCommands", () => ({ registerMiscCommands: () => registerMisc() }));
vi.mock("./workspaceCommands", () => ({
  registerWorkspaceCommands: () => registerWorkspace(),
}));
vi.mock("./recentFilesCommands", () => ({
  registerRecentFilesCommands: () => registerRecentFiles(),
}));
vi.mock("./recentWorkspacesCommands", () => ({
  registerRecentWorkspacesCommands: () => registerRecentWorkspaces(),
}));
vi.mock("./viewCommands", () => ({ registerViewCommands: () => registerView() }));
vi.mock("./formatCommands", () => ({
  registerFormatCommands: () => registerFormat(),
}));
vi.mock("@/utils/debug", () => ({ menuError: (...args: unknown[]) => menuErrorMock(...args) }));

import { useCommandBootstrap } from "./useCommandBootstrap";

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

  // Default happy-path behaviors — individual tests override as needed.
  registerPandocMock.mockResolvedValue([]);
  mountMenuCommandsMock.mockResolvedValue(() => {});
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

  it("invokes the unlistener when the hook unmounts after a normal mount", async () => {
    const off = vi.fn();
    mountMenuCommandsMock.mockResolvedValueOnce(off);
    const { unmount } = renderHook(() => useCommandBootstrap());
    await Promise.resolve();
    await Promise.resolve();
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("invokes the unlistener when unmount races mountMenuCommands resolution (audit Round A H4)", async () => {
    const off = vi.fn();
    // Capture the resolver so we can defer resolution past unmount.
    let resolveOff: ((fn: () => void) => void) | null = null;
    mountMenuCommandsMock.mockImplementationOnce(
      () =>
        new Promise<() => void>((resolve) => {
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
    resolveOff!(off);
    // Flush the awaited continuation and the synchronous off() call.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(off).toHaveBeenCalledTimes(1);
  });
});
