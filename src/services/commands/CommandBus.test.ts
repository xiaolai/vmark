// @vitest-environment node
/**
 * CommandBus tests — ADR-012.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  registerCommand,
  registerCommands,
  unregisterOwner,
  executeCommand,
  searchCommands,
  listCommands,
  getCommand,
  hasCommand,
  unregisterCommand,
  _resetCommandBus,
  type CommandDefinition,
} from "./CommandBus";

const noopRun = vi.fn();

function cmd(id: string, title: string, overrides: Partial<CommandDefinition> = {}): CommandDefinition {
  return { id, title, run: noopRun, ...overrides };
}

describe("CommandBus", () => {
  beforeEach(() => {
    _resetCommandBus();
    noopRun.mockReset();
  });

  describe("registration", () => {
    it("registers commands by id", () => {
      registerCommand(cmd("doc.save", "Save Document"));
      expect(getCommand("doc.save")?.title).toBe("Save Document");
    });

    it("rejects duplicate ids", () => {
      registerCommand(cmd("doc.save", "Save"));
      expect(() => registerCommand(cmd("doc.save", "Save Again"))).toThrow(/already registered/);
    });

    it("listCommands returns every registered command", () => {
      registerCommand(cmd("a", "Alpha"));
      registerCommand(cmd("b", "Beta"));
      expect(listCommands()).toHaveLength(2);
    });
  });

  describe("owner-based batch registration (WI-3.3)", () => {
    const OWNER = "editor-actions";

    it("registers a batch and returns a working disposer", () => {
      const dispose = registerCommands(OWNER, [cmd("editor.bold", "Bold"), cmd("editor.italic", "Italic")]);
      expect(hasCommand("editor.bold")).toBe(true);
      dispose();
      expect(hasCommand("editor.bold")).toBe(false);
      expect(hasCommand("editor.italic")).toBe(false);
    });

    it("double bootstrap is idempotent (replace-own, no throw)", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      expect(() => registerCommands(OWNER, [cmd("editor.bold", "Bold")])).not.toThrow();
      expect(listCommands().filter((c) => c.id === "editor.bold")).toHaveLength(1);
    });

    it("HMR replacement swaps the owner's batch, removing stale ids", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold"), cmd("editor.strike", "Strike")]);
      registerCommands(OWNER, [cmd("editor.bold", "Bold v2")]); // strike dropped
      expect(getCommand("editor.bold")?.title).toBe("Bold v2");
      expect(hasCommand("editor.strike")).toBe(false);
    });

    it("recovers from a partial prior batch (replace-own re-registers the full set)", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]); // pretend a prior partial batch
      registerCommands(OWNER, [cmd("editor.bold", "Bold"), cmd("editor.italic", "Italic")]);
      expect(hasCommand("editor.bold")).toBe(true);
      expect(hasCommand("editor.italic")).toBe(true);
    });

    it("PREFLIGHTS a foreign collision and registers NOTHING", () => {
      registerCommand(cmd("editor.bold", "Bold (plain)")); // a non-owned registrar
      expect(() =>
        registerCommands(OWNER, [cmd("editor.italic", "Italic"), cmd("editor.bold", "Bold")]),
      ).toThrow(/already registered/);
      // atomic: italic must NOT have been registered despite preceding the collision
      expect(hasCommand("editor.italic")).toBe(false);
    });

    it("rejects a collision with another owner's id", () => {
      registerCommands("other-owner", [cmd("editor.bold", "Bold")]);
      expect(() => registerCommands(OWNER, [cmd("editor.bold", "Bold")])).toThrow(/already registered/);
    });

    it("survives _resetCommandBus (owners cleared, re-register works)", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      _resetCommandBus();
      expect(() => registerCommands(OWNER, [cmd("editor.bold", "Bold")])).not.toThrow();
      expect(hasCommand("editor.bold")).toBe(true);
    });

    it("unregisterOwner is idempotent", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      unregisterOwner(OWNER);
      expect(() => unregisterOwner(OWNER)).not.toThrow();
      expect(hasCommand("editor.bold")).toBe(false);
    });

    it("plain unregisterCommand clears the owner claim (no stale-owner desync)", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      unregisterCommand("editor.bold"); // removes from REGISTRY *and* OWNERS
      registerCommand(cmd("editor.bold", "Bold (plain)")); // a different, unowned registrar
      // The former owner must NOT be able to replace the plain registration.
      expect(() => registerCommands(OWNER, [cmd("editor.bold", "Bold")])).toThrow(/already registered/);
      expect(getCommand("editor.bold")?.title).toBe("Bold (plain)");
    });

    it("a stale disposer (from a superseded batch) does not remove the live batch", () => {
      const disposeFirst = registerCommands(OWNER, [cmd("editor.bold", "Bold v1")]);
      registerCommands(OWNER, [cmd("editor.bold", "Bold v2")]); // supersedes; bumps generation
      disposeFirst(); // stale generation → must be a no-op
      expect(hasCommand("editor.bold")).toBe(true);
      expect(getCommand("editor.bold")?.title).toBe("Bold v2");
    });

    it("rejects a batch containing a DUPLICATE id, registering nothing", () => {
      expect(() =>
        registerCommands(OWNER, [cmd("editor.bold", "Bold"), cmd("editor.bold", "Bold again")]),
      ).toThrow(/[Dd]uplicate/);
      expect(hasCommand("editor.bold")).toBe(false);
    });

    it("a duplicate-id rejection leaves the owner's PRIOR live batch intact", () => {
      registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      expect(() =>
        registerCommands(OWNER, [cmd("editor.x", "X"), cmd("editor.x", "X dup")]),
      ).toThrow(/[Dd]uplicate/);
      expect(hasCommand("editor.bold")).toBe(true); // prior batch untouched
      expect(hasCommand("editor.x")).toBe(false);
    });

    it("a disposer captured before _resetCommandBus does not remove a same-owner re-register", () => {
      const staleDispose = registerCommands(OWNER, [cmd("editor.bold", "Bold v1")]);
      _resetCommandBus();
      registerCommands(OWNER, [cmd("editor.bold", "Bold v2")]); // fresh token, not reused
      staleDispose(); // token no longer current → no-op
      expect(hasCommand("editor.bold")).toBe(true);
      expect(getCommand("editor.bold")?.title).toBe("Bold v2");
    });

    it("one owner's disposer never removes another owner's commands (interleaving)", () => {
      const disposeA = registerCommands("A", [cmd("a.one", "A1")]);
      registerCommands("B", [cmd("b.one", "B1")]);
      disposeA();
      expect(hasCommand("a.one")).toBe(false);
      expect(hasCommand("b.one")).toBe(true); // B untouched
    });

    it("unregisterOwner then re-register: the first disposer is a no-op", () => {
      const firstDispose = registerCommands(OWNER, [cmd("editor.bold", "Bold")]);
      unregisterOwner(OWNER);
      registerCommands(OWNER, [cmd("editor.bold", "Bold v2")]); // fresh token
      firstDispose();
      expect(hasCommand("editor.bold")).toBe(true);
    });
  });

  describe("resilient when() evaluation", () => {
    it("a throwing when() does not crash search — the command is treated as unavailable", () => {
      registerCommand(cmd("ok", "OK"));
      registerCommand(cmd("boom", "Boom", { when: () => { throw new Error("nope"); } }));
      const results = searchCommands("", {});
      expect(results.map((r) => r.command.id)).toContain("ok");
      expect(results.map((r) => r.command.id)).not.toContain("boom");
    });

    it("a throwing when() makes executeCommand return false and never runs the body", async () => {
      registerCommand(cmd("boom", "Boom", { when: () => { throw new Error("nope"); } }));
      await expect(executeCommand("boom")).resolves.toBe(false);
      expect(noopRun).not.toHaveBeenCalled();
    });

    it("unregisterCommand removes the entry", () => {
      registerCommand(cmd("doc.save", "Save"));
      unregisterCommand("doc.save");
      expect(getCommand("doc.save")).toBeUndefined();
    });

    it("hasCommand reports registry membership", () => {
      expect(hasCommand("doc.save")).toBe(false);
      registerCommand(cmd("doc.save", "Save"));
      expect(hasCommand("doc.save")).toBe(true);
      unregisterCommand("doc.save");
      expect(hasCommand("doc.save")).toBe(false);
    });
  });

  describe("execution", () => {
    it("invokes the run function with args and context", async () => {
      const run = vi.fn();
      registerCommand(cmd("foo", "Foo", { run }));
      const ok = await executeCommand("foo", { count: 1 }, { mode: "wysiwyg" });
      expect(ok).toBe(true);
      expect(run).toHaveBeenCalledWith({ count: 1 }, { mode: "wysiwyg" });
    });

    it("returns false for unknown ids", async () => {
      expect(await executeCommand("nope")).toBe(false);
    });

    it("honors when predicate by skipping execution", async () => {
      const run = vi.fn();
      registerCommand(
        cmd("editor.bold", "Bold", { when: (ctx) => ctx.mode === "wysiwyg", run }),
      );
      const ok = await executeCommand("editor.bold", undefined, { mode: "source" });
      expect(ok).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });
  });

  describe("search", () => {
    beforeEach(() => {
      registerCommand(cmd("doc.save", "Save Document", { description: "Persist changes" }));
      registerCommand(cmd("doc.saveAs", "Save As…"));
      registerCommand(cmd("editor.bold", "Bold", { description: "Toggle bold mark" }));
    });

    it("returns matching commands sorted by score", () => {
      const results = searchCommands("save");
      expect(results.map((r) => r.command.id)).toEqual(["doc.save", "doc.saveAs"]);
    });

    it("returns all commands when query is empty", () => {
      expect(searchCommands("")).toHaveLength(3);
    });

    it("filters out commands whose when() rejects the context", () => {
      registerCommand(
        cmd("editor.italic", "Italic", { when: (ctx) => ctx.mode === "wysiwyg" }),
      );
      const results = searchCommands("", { mode: "source" });
      expect(results.map((r) => r.command.id)).not.toContain("editor.italic");
    });

    it("matches description as a lower-priority signal", () => {
      const results = searchCommands("persist");
      expect(results[0].command.id).toBe("doc.save");
    });
  });
});
