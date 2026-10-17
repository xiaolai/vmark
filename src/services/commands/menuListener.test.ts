// @vitest-environment node
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


const safeUnlistenAllMock = vi.fn();
const safeUnlistenMock = vi.fn();
vi.mock("@/utils/safeUnlisten", () => ({
  safeUnlistenAll: (fns: unknown[]) => safeUnlistenAllMock(fns),
  safeUnlisten: (fn: unknown) => safeUnlistenMock(fn),
}));

const menuErrorMock = vi.fn();
vi.mock("@/utils/debug", () => ({
  menuError: (...args: unknown[]) => menuErrorMock(...args),
}));

// Import after mocks register so hoisting wires correctly.
import { decodeMenuPayload, mountMenuCommands, type MenuCommandBinding } from "./menuListener";
import { _resetCommandBus, registerCommand } from "./CommandBus";
import { getEditorActionOwner } from "@/services/editor/editorActionOwner";

// The real CommandBus runs. Every id these tests bind is registered with a spy
// body, so the tests about the payload filter say nothing about registration;
// the preflight tests take ids away. `cmd.missing` is never registered.
const KNOWN_IDS = [
  "cmd.do",
  "cmd.a",
  "cmd.b",
  "cmd.c",
  "cmd.ok",
  "file.open",
  "file.save",
  "file.saveOther",
  "file.openRecent",
] as const;
type RunSpy = ReturnType<typeof vi.fn<(args: unknown, ctx: unknown) => Promise<void>>>;
const runs = new Map<string, RunSpy>();

/** The body of a registered command — what the bus runs on dispatch. */
function run(id: string): RunSpy {
  const spy = runs.get(id);
  if (!spy) throw new Error(`no registered command ${id}`);
  return spy;
}

/** Whether ANY registered command body ran. */
function anyCommandRan(): boolean {
  return [...runs.values()].some((spy) => spy.mock.calls.length > 0);
}

beforeEach(() => {
  listenSpy.mockReset();
  unlistenSpies.length = 0;
  safeUnlistenAllMock.mockReset();
  safeUnlistenMock.mockReset();
  menuErrorMock.mockReset();
  _resetCommandBus();
  runs.clear();
  for (const id of KNOWN_IDS) {
    const spy: RunSpy = vi.fn(async () => {});
    runs.set(id, spy);
    registerCommand({ id, title: id, run: spy });
  }

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
  const { off: unlisten } = await mountMenuCommands([{ menuEvent, commandId }]);
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
    // The ARGUMENT is `undefined`, not the payload: a bare string payload is
    // the routing target and carries no data (audit #915). This case is about
    // the filter dispatching at all; the argument itself is pinned below.
    expect(run("cmd.do")).toHaveBeenCalledWith(undefined, {
      windowLabel: "main",
    });
  });

  it("ignores a string payload that targets a different window", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: "other" });
    expect(anyCommandRan()).toBe(false);
    expect(menuErrorMock).not.toHaveBeenCalled();
  });

  it("dispatches when payload is a tuple whose second element matches the label", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: [123, "main"] });
    // Only the tuple's DATA element reaches the command — the envelope's window
    // label is routing, not an argument (audit #915).
    expect(run("cmd.do")).toHaveBeenCalledWith(123,
      { windowLabel: "main" },
    );
  });

  it("ignores a tuple payload that targets a different window", async () => {
    const { callback } = await mountSingle("foo");
    await callback?.({ payload: [123, "other"] });
    expect(anyCommandRan()).toBe(false);
    expect(menuErrorMock).not.toHaveBeenCalled();
  });

  it("refuses unknown payload shapes (number / object / null) and logs", async () => {
    const { callback } = await mountSingle("foo");
    for (const bad of [42, { not: "expected" }, null] as const) {
      await callback?.({ payload: bad });
    }
    expect(anyCommandRan()).toBe(false);
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
    run("cmd.do").mockRejectedValueOnce(new Error("command exploded"));
    const { callback } = await mountSingle("foo");
    // The listener satisfies Tauri's EventCallback, so it returns void rather
    // than a promise — awaiting its return would assert the old shape, not the
    // behaviour. What matters is that the rejection never reaches the caller
    // and IS reported.
    expect(() => callback?.({ payload: "main" })).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(menuErrorMock).toHaveBeenCalledTimes(1);
    expect(String(menuErrorMock.mock.calls[0][0])).toContain("threw");
  });
});

describe("mountMenuCommands — cleanup (#957)", () => {
  it("returned unlistener calls safeUnlistenAll with every per-binding unlisten", async () => {
    const { off: unlisten } = await mountMenuCommands([
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

// WI-2.3 — one menu event, one dispatcher: duplicate bindings rejected at mount.
describe("mountMenuCommands — duplicate rejection (WI-2.3)", () => {
  it("throws on a duplicate normalized menu event, mounting nothing", async () => {
    listenSpy.mockClear();
    await expect(
      mountMenuCommands([
        { menuEvent: "menu:save", commandId: "file.save" },
        { menuEvent: "save", commandId: "file.saveOther" }, // same event, un-prefixed
      ]),
    ).rejects.toThrow(/Duplicate menu binding for "menu:save"/);
    expect(listenSpy).not.toHaveBeenCalled(); // preflight fails before any listen
  });

  it("accepts a batch with all-distinct events", async () => {
    listenSpy.mockClear();
    listenSpy.mockResolvedValue(vi.fn());
    await expect(
      mountMenuCommands([
        { menuEvent: "menu:save", commandId: "file.save" },
        { menuEvent: "menu:open", commandId: "file.open" },
      ]),
    ).resolves.toMatchObject({ failed: [], off: expect.any(Function) });
    expect(listenSpy).toHaveBeenCalledTimes(2);
  });
});

// Audit #359 (round 3) — the mount is BEST-EFFORT and reports its own
// completeness. Round 2 made it all-or-nothing, which turned one bad
// registration into a window with NO menu at all: strictly worse for the user
// than the partial menu it replaced, and the bootstrap declared it ready
// anyway. The batch now mounts everything it can and names what it could not,
// so the readiness signal can carry the truth instead of a guess.
describe("mountMenuCommands — completeness result (audit #359)", () => {
  /** Make listen() reject for one event and mount normally for the rest. */
  function failListenFor(event: string) {
    listenSpy.mockImplementation(async (name) => {
      if (name === event) throw new Error(`registry inconsistent for ${name}`);
      const off = vi.fn();
      unlistenSpies.push(off);
      return off;
    });
  }

  it("keeps the rest of the menu listening and names the binding that failed", async () => {
    failListenFor("menu:b");
    const { off, failed } = await mountMenuCommands([
      { menuEvent: "a", commandId: "cmd.a" },
      { menuEvent: "b", commandId: "cmd.b" },
      { menuEvent: "c", commandId: "cmd.c" },
    ]);
    // Every binding is attempted — the failure does not stop the batch — and
    // the two that CAN listen do.
    expect(listenSpy).toHaveBeenCalledTimes(3);
    expect(unlistenSpies).toHaveLength(2);
    expect(failed).toEqual(["menu:b"]);
    expect(safeUnlistenAllMock).not.toHaveBeenCalled();
    off();
    expect(safeUnlistenAllMock).toHaveBeenCalledWith(unlistenSpies);
  });

  it("logs the failure with the underlying listen() error", async () => {
    failListenFor("menu:a");
    const { failed } = await mountMenuCommands([{ menuEvent: "a", commandId: "cmd.a" }]);
    expect(failed).toEqual(["menu:a"]);
    expect(menuErrorMock).toHaveBeenCalledWith(
      expect.stringContaining("menu:a"),
      expect.objectContaining({ message: "registry inconsistent for menu:a" }),
    );
  });

  it("reports every binding as failed when nothing can listen, without rejecting", async () => {
    listenSpy.mockImplementation(async (name) => {
      throw new Error(`dead bridge for ${name}`);
    });
    const { failed } = await mountMenuCommands([
      { menuEvent: "a", commandId: "cmd.a" },
      { menuEvent: "b", commandId: "cmd.b" },
    ]);
    expect(failed).toEqual(["menu:a", "menu:b"]);
  });

  it("disposes the window's editor-action retry owner when the mount is torn down", async () => {
    const owner = getEditorActionOwner("main");
    failListenFor("menu:bold");
    const { off, failed } = await mountMenuCommands([
      { menuEvent: "menu:save", commandId: "file.save" },
      { kind: "editorAction", menuEvent: "menu:bold", mapping: { actionId: "bold" } },
    ]);
    expect(failed).toEqual(["menu:bold"]);
    // A binding that could not mount must not take the owner down with it —
    // the surviving editor actions still need their retry timers.
    expect(owner.isDisposed()).toBe(false);
    off();
    expect(owner.isDisposed()).toBe(true);
  });

  it("leaves the editor-action owner alone when the batch had no editor actions", async () => {
    const owner = getEditorActionOwner("main");
    failListenFor("menu:a");
    const { off } = await mountMenuCommands([{ menuEvent: "a", commandId: "cmd.a" }]);
    off();
    expect(owner.isDisposed()).toBe(false);
    owner.dispose(); // leave no live owner behind for the next test
  });
});

describe("routing envelope is decoded away before dispatch (audit #915)", () => {
  it("passes the tuple's DATA element as the command argument, not the envelope", async () => {
    const { callback } = await mountSingle("menu:open-recent-file", "file.openRecent");

    await callback?.({ payload: ["/tmp/notes.md", "main"] });

    // `[data, windowLabel]` is the transport, not the argument. Forwarding it
    // verbatim handed every recent-entry command the window label as part of
    // its own payload.
    expect(run("file.openRecent")).toHaveBeenCalledWith("/tmp/notes.md", {
      windowLabel: "main",
    });
  });

  it("passes NO argument when the payload is a bare window label", async () => {
    const { callback } = await mountSingle("menu:open-recent-file", "file.openRecent");

    await callback?.({ payload: "main" });

    // A string payload is the routing target and carries no data at all.
    // Forwarding it made `parseRecentPathArgs` read "main" as a FILE PATH.
    expect(run("file.openRecent")).toHaveBeenCalledWith(undefined, {
      windowLabel: "main",
    });
  });
});

describe("unregistered command targets (audit #916)", () => {
  it("does not mount a binding whose command does not exist, and reports it", async () => {

    const { failed } = await mountMenuCommands([
      { menuEvent: "menu:ok", commandId: "cmd.ok" },
      { menuEvent: "menu:gone", commandId: "cmd.missing" },
    ]);

    // `executeCommand` answers `false` for BOTH "no such command" and "when()
    // said no", so a dead menu item is indistinguishable from a disabled one at
    // dispatch time. Catching it at mount is what makes readiness honest.
    expect(failed).toEqual(["menu:gone"]);
    expect(listenSpy).toHaveBeenCalledTimes(1);
    expect(listenSpy.mock.calls[0]?.[0]).toBe("menu:ok");
    expect(menuErrorMock.mock.calls.flat().join(" ")).toContain("cmd.missing");
  });

  it("does not preflight editor-action bindings, which never touch the bus", async () => {
    _resetCommandBus(); // no command exists at all

    const { failed } = await mountMenuCommands([
      { kind: "editorAction", menuEvent: "menu:bold", mapping: { actionId: "bold" } },
    ]);

    expect(failed).toEqual([]);
    expect(listenSpy).toHaveBeenCalledTimes(1);
  });
});

/** Hold every listen() open until the test lands it, in any order. */
function deferListens() {
  const pending: { event: string; off: ReturnType<typeof vi.fn>; land: () => void; refuse: (e: Error) => void }[] = [];
  listenSpy.mockImplementation((event) => new Promise((resolve, reject) => {
    const off = vi.fn();
    pending.push({ event, off, land: () => resolve(off), refuse: reject });
  }));
  return pending;
}

/** Let every settled listen() continuation run. */
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

// WI-OC1.2 — the mount used to await each listen() in turn: ~155 IPC round
// trips in series, which on a loaded machine outlasted the window's 5 s
// readiness budget before the document was even involved. It now requests
// every listener at once. That replaced the audit #711 abort test, which
// polled `shouldAbort` BETWEEN sequential registrations: with nothing in
// between any more, cancellation is an AbortSignal that tears the pass down
// the moment it fires.
describe("concurrent mount (WI-OC1.2)", () => {
  const ABC = [
    { menuEvent: "a", commandId: "cmd.a" },
    { menuEvent: "b", commandId: "cmd.b" },
    { menuEvent: "c", commandId: "cmd.c" },
  ];

  it("requests every listener before any registration lands", async () => {
    const pending = deferListens();
    const mounting = mountMenuCommands(ABC);

    expect(listenSpy.mock.calls.map(([event]) => event)).toEqual(["menu:a", "menu:b", "menu:c"]);

    for (const p of pending) p.land();
    await expect(mounting).resolves.toMatchObject({ failed: [] });
  });

  it("reports failures in binding order, however the registrations settle", async () => {
    const pending = deferListens();
    const mounting = mountMenuCommands(ABC);
    pending[2].refuse(new Error("refused c"));
    pending[1].land();
    pending[0].refuse(new Error("refused a"));

    const { failed } = await mounting;
    expect(failed).toEqual(["menu:a", "menu:c"]);
  });

  it("an abort removes every landed listener at once, and each late one as it lands", async () => {
    const pending = deferListens();
    const controller = new AbortController();
    const mounting = mountMenuCommands(ABC, { signal: controller.signal });
    pending[0].land();
    pending[1].land();
    await settle();

    controller.abort();
    expect(safeUnlistenAllMock).toHaveBeenCalledExactlyOnceWith([pending[0].off, pending[1].off]);

    pending[2].land();
    const { off } = await mounting;
    expect(safeUnlistenMock).toHaveBeenCalledExactlyOnceWith(pending[2].off);

    // The caller's own `off()` stays safe to call: teardown is idempotent.
    off();
    expect(safeUnlistenAllMock).toHaveBeenCalledTimes(1);
  });

  it("a torn-down pass dispatches nothing, even for an event already on its way", async () => {
    const controller = new AbortController();
    await mountMenuCommands([{ menuEvent: "a", commandId: "cmd.a" }], { signal: controller.signal });
    const callback = listenSpy.mock.calls[0]?.[1];

    controller.abort();
    callback?.({ payload: "main" });
    await settle();

    expect(anyCommandRan()).toBe(false);
  });

  it("registers nothing for a pass aborted before it starts", async () => {
    const controller = new AbortController();
    controller.abort();
    const { failed } = await mountMenuCommands(ABC, { signal: controller.signal });

    expect(listenSpy).not.toHaveBeenCalled();
    expect(failed).toEqual([]);
  });

  it("a replaced pass torn down late does not cancel its replacement's retries", async () => {
    vi.useFakeTimers();
    try {
      const bold: MenuCommandBinding[] = [{ kind: "editorAction", menuEvent: "menu:bold", mapping: { actionId: "bold" } }];
      const first = await mountMenuCommands(bold);
      const second = await mountMenuCommands(bold);
      const owner = getEditorActionOwner("main");
      const retry = vi.fn();
      owner.scheduleRetry(retry);

      first.off();
      vi.runOnlyPendingTimers();
      expect(retry).toHaveBeenCalledTimes(1);
      expect(owner.isDisposed()).toBe(false);

      second.off();
      expect(owner.isDisposed()).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Audit #912 / #915 — the routing envelope's decode is the one rule in this
// module that has already been wrong in production, and it lived three closures
// deep inside a `listen` callback where nothing could reach it directly. A bare
// string IS the target window label and carries NO argument; a tuple is
// `[data, windowLabel]`. Forwarding the payload verbatim handed
// `file.openRecent` the window label as its path.
describe("decodeMenuPayload", () => {
  it("treats a bare string as the target label, with no argument", () => {
    expect(decodeMenuPayload("main", "main")).toEqual({ kind: "dispatch", args: undefined });
  });

  it("never passes the window label on as an argument", () => {
    const decoded = decodeMenuPayload("main", "main");
    expect(decoded.kind === "dispatch" && decoded.args).not.toBe("main");
  });

  it("unwraps a tuple to its data half", () => {
    expect(decodeMenuPayload([{ path: "/a.md" }, "main"], "main")).toEqual({
      kind: "dispatch",
      args: { path: "/a.md" },
    });
  });

  it("passes a falsy argument through rather than dropping it", () => {
    expect(decodeMenuPayload([0, "main"], "main")).toEqual({ kind: "dispatch", args: 0 });
    expect(decodeMenuPayload([null, "main"], "main")).toEqual({ kind: "dispatch", args: null });
  });

  it("ignores an event addressed to another window, in both shapes", () => {
    expect(decodeMenuPayload("other", "main")).toEqual({ kind: "other-window" });
    expect(decodeMenuPayload(["/a.md", "other"], "main")).toEqual({ kind: "other-window" });
  });

  it("refuses a shape the protocol does not define", () => {
    expect(decodeMenuPayload({ windowLabel: "main" }, "main")).toEqual({ kind: "unknown" });
    expect(decodeMenuPayload(undefined, "main")).toEqual({ kind: "unknown" });
    expect(decodeMenuPayload(42, "main")).toEqual({ kind: "unknown" });
  });

  it("refuses a tuple whose label slot is missing rather than guessing", () => {
    expect(decodeMenuPayload(["/a.md"], "main")).toEqual({ kind: "other-window" });
  });
});
