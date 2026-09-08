/**
 * Mount/unmount lifecycle of useGenieShortcuts (audit #736, #738).
 *
 * Two failures that are invisible in ordinary use and leave no trace:
 *   - the menu refresh resolving AFTER the cleanup hid the menu, putting the
 *     Genies submenu back for a feature that was just switched off;
 *   - a `listen()` registration that rejects with nobody waiting on it: an
 *     unhandled rejection at mount, and no diagnostic anywhere. Asserted
 *     through the WARNING rather than through `process.on("unhandledRejection")`
 *     — a `vi.fn` tracks the promise it returns, which counts as a handler, so
 *     that check reads green in this harness whether or not the fix is there.
 *
 * Only BOUNDARIES are mocked here (Tauri's invoke and event APIs). The stores
 * run for real.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type EventHandler = (event: { payload: unknown }) => void | Promise<void>;

const mockInvoke = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>();
const mockListen =
  vi.fn<(event: string, handler: EventHandler) => Promise<() => void>>();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => mockInvoke(cmd, args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, handler: EventHandler) => mockListen(event, handler),
}));

// Only `genieWarn` is replaced — the rest of the debug surface stays real, so
// this cannot become a second, drifting copy of that module.
const genieWarn = vi.fn();
vi.mock("@/utils/debug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/debug")>()),
  genieWarn: (...args: unknown[]) => genieWarn(...args),
}));

import { act, renderHook } from "@testing-library/react";
import { useGenieShortcuts } from "./useGenieShortcuts";

/** A promise plus the lever that settles it. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Names of the commands invoked so far, in order. */
function invokedCommands(): string[] {
  return mockInvoke.mock.calls.map(([cmd]) => cmd);
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockListen.mockReset();
  genieWarn.mockReset();
  mockInvoke.mockResolvedValue([]);
  mockListen.mockResolvedValue(() => {});
});

describe("the menu load is unmount-aware (#736)", () => {
  it("does not refresh the native menu after the cleanup hid it", async () => {
    const listing = deferred<unknown>();
    mockInvoke.mockImplementation((cmd) =>
      cmd === "list_genies" ? listing.promise : Promise.resolve(),
    );

    const { unmount } = renderHook(() => useGenieShortcuts());
    // The disk read is still in flight when the feature is switched off.
    unmount();

    await act(async () => {
      listing.resolve([]);
      await Promise.resolve();
    });

    expect(invokedCommands()).toContain("hide_genies_menu");
    expect(invokedCommands()).not.toContain("refresh_genies_menu");
  });

  it("refreshes the menu on a mount that survives the load", async () => {
    await act(async () => {
      renderHook(() => useGenieShortcuts());
      await Promise.resolve();
    });

    expect(invokedCommands()).toContain("refresh_genies_menu");
  });
});

describe("listener registration failures are handled where they happen (#738)", () => {
  it("warns at REGISTRATION time, not at some later cleanup", async () => {
    mockListen.mockImplementation((event) =>
      event === "menu:invoke-genie"
        ? Promise.reject(new Error("event channel gone"))
        : Promise.resolve(() => {}),
    );

    const { unmount } = renderHook(() => useGenieShortcuts());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Before ANY cleanup runs. Without a handler here the rejection sat on a
    // promise nobody was waiting on: no diagnostic, and — outside this
    // harness, where a spy is not holding the promise — an unhandled rejection.
    expect(genieWarn).toHaveBeenCalledWith(
      expect.stringContaining("menu:invoke-genie"),
      expect.any(Error),
    );
    expect(() => unmount()).not.toThrow();
  });

  it("unmount is safe when every registration failed", async () => {
    mockListen.mockRejectedValue(new Error("event channel gone"));

    const { unmount } = renderHook(() => useGenieShortcuts());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(() => unmount()).not.toThrow();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(genieWarn).toHaveBeenCalledTimes(2); // one per failed listener
  });
});
