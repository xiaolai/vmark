/**
 * #1419 — pushing the close-to-tray preference to Rust.
 *
 * Rust cannot read the webview's settings, so the webview pushes the value on
 * mount and on every change — the same shape as `useConfirmQuitSync`. Rust
 * starts disabled, so until a push lands the app keeps the old close behaviour.
 *
 * The feature exists only on Windows, so the push does too: elsewhere the
 * command would record a value nothing reads, and skipping it keeps that
 * explicit instead of incidental.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";

const mockInvoke = vi.fn().mockResolvedValue(undefined);
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

const { useCloseToTraySync } = await import("./useCloseToTraySync");

const realPlatform = navigator.platform;

/** `isWindowsPlatform` reads navigator at call time, by design, for tests. */
function onPlatform(platform: string): void {
  Object.defineProperty(navigator, "platform", { value: platform, configurable: true });
}

beforeEach(() => {
  mockInvoke.mockClear();
  mockInvoke.mockResolvedValue(undefined);
  useSettingsStore.getState().resetSettings();
});

afterEach(() => {
  onPlatform(realPlatform);
});

describe("useCloseToTraySync on Windows", () => {
  beforeEach(() => onPlatform("Win32"));

  it("pushes the default (off) on mount", () => {
    renderHook(() => useCloseToTraySync());
    expect(mockInvoke).toHaveBeenCalledWith("set_close_to_tray", { enabled: false });
  });

  it("pushes when the user turns it on", () => {
    const { rerender } = renderHook(() => useCloseToTraySync());
    mockInvoke.mockClear();

    act(() => useSettingsStore.getState().updateGeneralSetting("closeToTray", true));
    rerender();

    expect(mockInvoke).toHaveBeenCalledWith("set_close_to_tray", { enabled: true });
  });

  it("pushes when the user turns it back off", () => {
    act(() => useSettingsStore.getState().updateGeneralSetting("closeToTray", true));
    const { rerender } = renderHook(() => useCloseToTraySync());
    mockInvoke.mockClear();

    act(() => useSettingsStore.getState().updateGeneralSetting("closeToTray", false));
    rerender();

    expect(mockInvoke).toHaveBeenCalledWith("set_close_to_tray", { enabled: false });
  });

  it("does not re-push when an unrelated setting changes", () => {
    const { rerender } = renderHook(() => useCloseToTraySync());
    mockInvoke.mockClear();

    act(() => useSettingsStore.getState().updateGeneralSetting("autoSaveEnabled", false));
    rerender();

    expect(mockInvoke).not.toHaveBeenCalled();
  });

  /**
   * A failed push must not throw into React. Rust stays on its previous value
   * — off, for a fresh start — which is the old, known-safe behaviour.
   */
  it("survives a failed push", async () => {
    mockInvoke.mockRejectedValueOnce(new Error("ipc down"));
    expect(() => renderHook(() => useCloseToTraySync())).not.toThrow();
    await Promise.resolve();
  });
});

describe("useCloseToTraySync elsewhere", () => {
  it.each(["MacIntel", "Linux x86_64"])("never pushes on %s", (platform) => {
    onPlatform(platform);
    act(() => useSettingsStore.getState().updateGeneralSetting("closeToTray", true));
    renderHook(() => useCloseToTraySync());
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
