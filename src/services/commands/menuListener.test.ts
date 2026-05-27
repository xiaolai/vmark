/**
 * menuListener — payload-shape filter tests (audit #957).
 *
 * The window-targeting filter is security-relevant: a wrong-shape payload
 * that slips past it would route a menu command into the wrong window.
 * Existing useCommandBootstrap tests mock mountMenuCommands wholesale, so
 * the filter itself was never executed under test. These tests register
 * the listener with a fake window and exercise each branch directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted above the SUT import below.
// ---------------------------------------------------------------------------

type Listener = (event: { payload: unknown }) => void;

const listenSpy = vi.fn<(event: string, cb: Listener) => Promise<() => void>>();
const unlistenSpies: ReturnType<typeof vi.fn>[] = [];

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "main",
    listen: listenSpy,
  }),
}));

const executeCommandMock = vi.fn();
vi.mock("./CommandBus", () => ({
  executeCommand: (...args: unknown[]) => executeCommandMock(...args),
}));

const safeUnlistenAllMock = vi.fn();
vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAll: (fns: unknown[]) => safeUnlistenAllMock(fns),
}));

const menuErrorMock = vi.fn();
vi.mock("@/utils/debug", () => ({
  menuError: (...args: unknown[]) => menuErrorMock(...args),
}));

// Import after mocks register so hoisting wires correctly.
import { mountMenuCommands } from "./menuListener";

beforeEach(() => {
  listenSpy.mockReset();
  unlistenSpies.length = 0;
  executeCommandMock.mockReset();
  safeUnlistenAllMock.mockReset();
  menuErrorMock.mockReset();

  // Default listen implementation: capture the callback and return a
  // fresh unlisten spy per call so tests can verify cleanup per binding.
  listenSpy.mockImplementation(async () => {
    const off = vi.fn();
    unlistenSpies.push(off);
    return off;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function mountSingle(menuEvent: string, commandId = "cmd.do") {
  const unlisten = await mountMenuCommands([{ menuEvent, commandId }]);
  // Pull out the most recently captured listener so tests can fire payloads.
  const callback = listenSpy.mock.calls[listenSpy.mock.calls.length - 1]?.[1] as
    | Listener
    | undefined;
  return { unlisten, callback };
}

describe("mountMenuCommands — payload-shape filter (#957)", () => {
  it("dispatches when payload is a string matching the current window label", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: "main" });
    expect(executeCommandMock).toHaveBeenCalledWith("cmd.do", "main", {
      windowLabel: "main",
    });
  });

  it("ignores a string payload that targets a different window", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: "other" });
    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(menuErrorMock).not.toHaveBeenCalled();
  });

  it("dispatches when payload is a tuple whose second element matches the label", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: [123, "main"] });
    expect(executeCommandMock).toHaveBeenCalledWith(
      "cmd.do",
      [123, "main"],
      { windowLabel: "main" },
    );
  });

  it("ignores a tuple payload that targets a different window", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: [123, "other"] });
    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(menuErrorMock).not.toHaveBeenCalled();
  });

  it("refuses unknown payload shapes (number / object / null) and logs", async () => {
    const { callback } = await mountSingle("foo");
    for (const bad of [42, { not: "expected" }, null] as const) {
      await callback?.({ payload: bad });
    }
    expect(executeCommandMock).not.toHaveBeenCalled();
    expect(menuErrorMock).toHaveBeenCalledTimes(3);
    // All three calls should mention the "unexpected payload shape" reason.
    for (const call of menuErrorMock.mock.calls) {
      expect(String(call[0])).toContain("unexpected payload shape");
    }
  });
});

describe("mountMenuCommands — menu: auto-prefix (#957)", () => {
  it('prefixes "menu:" when the binding omits it', async () => {
    await mountMenuCommands([{ menuEvent: "foo", commandId: "cmd.do" }]);
    expect(listenSpy).toHaveBeenCalledWith("menu:foo", expect.any(Function));
  });

  it('does NOT double-prefix when the binding already starts with "menu:"', async () => {
    await mountMenuCommands([{ menuEvent: "menu:bar", commandId: "cmd.do" }]);
    expect(listenSpy).toHaveBeenCalledWith("menu:bar", expect.any(Function));
  });
});

describe("mountMenuCommands — execution errors are swallowed (#957)", () => {
  it("does not propagate a rejection from executeCommand to the listener", async () => {
    executeCommandMock.mockRejectedValueOnce(new Error("command exploded"));
    const { callback } = await mountSingle("foo");
    // If the catch were missing, this would throw and the listener would
    // be torn down with an unhandled rejection.
    await expect(callback?.({ payload: "main" })).resolves.toBeUndefined();
    expect(menuErrorMock).toHaveBeenCalledTimes(1);
    expect(String(menuErrorMock.mock.calls[0][0])).toContain("threw");
  });
});

describe("mountMenuCommands — cleanup (#957)", () => {
  it("returned unlistener calls safeUnlistenAll with every per-binding unlisten", async () => {
    const unlisten = await mountMenuCommands([
      { menuEvent: "a", commandId: "cmd.a" },
      { menuEvent: "b", commandId: "cmd.b" },
      { menuEvent: "c", commandId: "cmd.c" },
    ]);
    expect(unlistenSpies).toHaveLength(3);

    unlisten();

    expect(safeUnlistenAllMock).toHaveBeenCalledTimes(1);
    expect(safeUnlistenAllMock).toHaveBeenCalledWith(unlistenSpies);
  });
});
