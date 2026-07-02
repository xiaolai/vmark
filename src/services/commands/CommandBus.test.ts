/**
 * CommandBus tests — ADR-012.
 */

import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  registerCommand,
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
