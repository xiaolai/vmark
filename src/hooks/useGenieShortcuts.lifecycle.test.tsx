/**
 * Mount/unmount lifecycle of useGenieShortcuts (audit #736, #738).
 *
 * Two failures that are invisible in ordinary use and leave no trace:
 *   - the menu refresh resolving AFTER the cleanup hid the menu, putting the
 *     Genies submenu back after the main window's runners unmounted;
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

import type { ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { WindowContext } from "@/contexts/WindowContext";
import { useGenieMenuInvocation, useGenieShortcuts } from "./useGenieShortcuts";

/** Both genie hooks, as the main window mounts them (runners + document mount). */
function useBothGenieHooks(): void {
  useGenieShortcuts();
  useGenieMenuInvocation();
}

function MainWindow({ children }: { children: ReactNode }) {
  return (
    <WindowContext.Provider value={{ windowLabel: "main", isDocumentWindow: true }}>
      {children}
    </WindowContext.Provider>
  );
}

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
    // `load_genies` is the menu load's only disk read (stores/aiStore/genies.ts).
    // Holding ITS reply back is what keeps the load in flight across unmount.
    const listing = deferred<unknown>();
    mockInvoke.mockImplementation((cmd) =>
      cmd === "load_genies" ? listing.promise : Promise.resolve(),
    );

    const { unmount } = renderHook(() => useGenieShortcuts());
    // The disk read is still in flight when the hook unmounts.
    unmount();

    // The load really was held back at the boundary: without this, a rename of
    // the command would let the load finish before unmount and the case below
    // would pass without ever exercising the race.
    expect(invokedCommands()).toContain("load_genies");

    await act(async () => {
      listing.resolve([]);
      await new Promise((resolve) => setTimeout(resolve, 0));
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

    const { unmount } = renderHook(() => useBothGenieHooks(), { wrapper: MainWindow });
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

    const { unmount } = renderHook(() => useBothGenieHooks(), { wrapper: MainWindow });
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
