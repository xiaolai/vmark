// Runs under jsdom, the default: viewCommands imports contentServerStore, which
// publishes a DEV debug handle on `window` at import time (the same reason
// viewCommands.test.ts carries no node-environment docblock).
// Audit 20260907 (#514): the sentinel-guarded registrars must be RETRYABLE.
// `registerAllCommands` (#453) rolls back every id its batch added when one
// registrar throws, so the remount retry starts from a clean bus. A
// module-level `registered` flag defeats that: it is a second source of truth
// the rollback cannot clear, so the retry hits `if (registered …) return` and
// the module's commands are simply missing — for the module whose own
// registration threw, and for EVERY module that registered before a later one
// failed. Two properties per module, over all ten sentinel-guarded modules:
//   A. own first `registerCommand` throws inside a rolled-back batch → retry
//      registers the whole set;
//   B. registered, then rolled back because a later registrar threw → retry
//      registers the whole set again.
// Each case loads a FRESH module graph (`vi.resetModules`), so a flag that
// survived one case cannot leak into the next.
import { beforeAll, describe, expect, it, vi } from "vitest";

type Bus = typeof import("./CommandBus");
type Command = Parameters<Bus["registerCommand"]>[0];

const h = vi.hoisted(() => ({ failNext: false }));

// The bus runs real; the two registration entry points gain a one-shot failure
// switch. BOTH are needed: since #459 the view/pane/lint sets register as owner
// batches through `registerCommands`, and a switch on `registerCommand` alone
// would never fire for them — the case would pass without injecting anything.
vi.mock("./CommandBus", async (importOriginal) => {
  const actual = await importOriginal<Bus>();
  const failOnce = () => {
    if (!h.failNext) return;
    h.failNext = false;
    throw new Error("registerCommand: injected failure");
  };
  return {
    ...actual,
    registerCommand: (command: Command) => {
      failOnce();
      actual.registerCommand(command);
    },
    registerCommands: (owner: string, commands: readonly Command[]) => {
      failOnce();
      return actual.registerCommands(owner, commands);
    },
  };
});

interface Case {
  name: string;
  /** An id the module must register — the old `hasCommand` guard's sentinel. */
  sentinel: string;
  /** Loads the registrar from the CURRENT module graph (fresh after resetModules). */
  load: () => Promise<() => void>;
}

const CASES: Case[] = [
  {
    name: "claimCommands",
    sentinel: "view.toggleClaims",
    load: async () => (await import("./claimCommands")).registerClaimCommands,
  },
  {
    name: "clipboardCommands",
    sentinel: "edit.copy",
    load: async () => (await import("./clipboardCommands")).registerClipboardCommands,
  },
  {
    name: "exportCommands",
    sentinel: "export.html",
    load: async () => (await import("./exportCommands")).registerExportCommands,
  },
  {
    name: "formatCommands",
    sentinel: "format.setPlainText",
    load: async () => (await import("./formatCommands")).registerFormatCommands,
  },
  {
    name: "lintCommands",
    sentinel: "lint.check",
    load: async () => (await import("./lintCommands")).registerLintCommands,
  },
  {
    name: "miscCommands",
    sentinel: "app.preferences",
    load: async () => (await import("./miscCommands")).registerMiscCommands,
  },
  {
    name: "paneCommands",
    sentinel: "view.toggleSplitDocuments",
    load: async () => (await import("./paneCommands")).registerPaneCommands,
  },
  {
    name: "recentFilesCommands",
    sentinel: "file.clearRecent",
    load: async () => (await import("./recentFilesCommands")).registerRecentFilesCommands,
  },
  {
    name: "recentWorkspacesCommands",
    sentinel: "workspace.clearRecent",
    load: async () => (await import("./recentWorkspacesCommands")).registerRecentWorkspacesCommands,
  },
  {
    name: "viewCommands",
    sentinel: "view.toggleSourceMode",
    load: async () => (await import("./viewCommands")).registerViewCommands,
  },
];

const ids = (bus: Bus) => bus.listCommands().map((c) => c.id).sort();

/** A fresh module graph: new bus, new module instance, no flag carried over. */
async function fresh(c: Case): Promise<{ bus: Bus; register: () => void }> {
  vi.resetModules();
  const bus = await import("./CommandBus");
  bus._resetCommandBus();
  h.failNext = false;
  return { bus, register: await c.load() };
}

/** The batch discipline of registerAllCommands, in miniature: snapshot, run,
 *  and on a throw restore the snapshot before re-throwing. The real one uses
 *  the same two calls — an id diff cannot undo an owner batch (#453). */
function inBatch(bus: Bus, run: () => void): void {
  const before = bus.snapshotCommandRegistry();
  try {
    run();
  } catch (error) {
    bus.restoreCommandRegistry(before);
    throw error;
  }
}

// What each module registers on a clean bus — measured, not listed, so a new
// command is covered the day it is added. Non-empty and sentinel-bearing, so a
// module that registers nothing cannot pass vacuously.
const expected = new Map<string, string[]>();
beforeAll(async () => {
  for (const c of CASES) {
    const { bus, register } = await fresh(c);
    register();
    const set = ids(bus);
    expect(set.length, c.name).toBeGreaterThan(0);
    expect(set, c.name).toContain(c.sentinel);
    expected.set(c.name, set);
  }
});

describe("registrars are retryable after the registerAllCommands rollback (#514)", () => {
  it.each(CASES)(
    "$name: a batch whose own first registerCommand threw registers the full set on retry",
    async (c) => {
      const { bus, register } = await fresh(c);

      h.failNext = true;
      expect(() => inBatch(bus, register)).toThrow("injected failure");
      // The rollback left nothing behind …
      expect(ids(bus)).toEqual([]);

      // … so the retry the bootstrap effect makes on remount must register
      // everything, not return early on a flag set before the throw.
      inBatch(bus, register);
      expect(ids(bus)).toEqual(expected.get(c.name));
    },
  );

  it.each(CASES)(
    "$name: registered, rolled back by a LATER registrar's failure, registers again on retry",
    async (c) => {
      const { bus, register } = await fresh(c);

      inBatch(bus, register);
      const set = expected.get(c.name) ?? [];
      expect(ids(bus)).toEqual(set);

      // registerAllCommands' rollback, as seen by THIS module: every id it
      // added is gone, and nothing told the module.
      for (const id of set) bus.unregisterCommand(id);
      expect(bus.hasCommand(c.sentinel)).toBe(false);

      // The remount retry: the bus is the only guard that can be right here.
      inBatch(bus, register);
      expect(ids(bus)).toEqual(set);
    },
  );

  // No fresh graph here on purpose: a WARM module instance over a populated bus
  // is the StrictMode / HMR re-bootstrap state, and the bus alone must make it
  // a no-op — `registerCommand` throws on a duplicate id, and an owner batch
  // replaces its own predecessor.
  it.each(CASES)("$name: a second call on a populated bus is a no-op, not a duplicate throw", async (c) => {
    const bus = await import("./CommandBus");
    bus._resetCommandBus();
    const register = await c.load();
    inBatch(bus, register);
    expect(() => register()).not.toThrow();
    expect(ids(bus)).toEqual(expected.get(c.name));
  });
});
