// @vitest-environment node
// Audit 20260907 (#453): registerAllCommands is a sequence of registrars, each
// guarded by a first-command sentinel. If one threw part-way, everything the
// batch had already registered stayed on the bus, and the retry the bootstrap
// effect makes on remount saw the sentinels and skipped — a permanently
// partial registry. The batch now rolls back every id it added and re-throws.
import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const h = await vi.hoisted(async () => {
  const bus = await import("./CommandBus");
  const flags = { genieThrows: false };
  const stub = (id: string) => () => {
    bus.registerCommand({ id, title: id, run: () => {} });
  };
  return { bus, flags, stub };
});

vi.mock("./miscCommands", () => ({ registerMiscCommands: h.stub("misc.a") }));
vi.mock("./windowCommands", () => ({ registerWindowCommands: h.stub("window.a") }));
vi.mock("./clipboardCommands", () => ({ registerClipboardCommands: h.stub("clipboard.a") }));
vi.mock("./exportCommands", () => ({ registerExportCommands: h.stub("export.a") }));
vi.mock("./workspaceCommands", () => ({ registerWorkspaceCommands: h.stub("workspace.a") }));
vi.mock("./recentFilesCommands", () => ({ registerRecentFilesCommands: h.stub("recentFiles.a") }));
vi.mock("./recentWorkspacesCommands", () => ({
  registerRecentWorkspacesCommands: h.stub("recentWorkspaces.a"),
}));
vi.mock("./viewCommands", () => ({ registerViewCommands: h.stub("view.a") }));
vi.mock("./claimCommands", () => ({ registerClaimCommands: h.stub("claim.a") }));
vi.mock("./formatCommands", () => ({ registerFormatCommands: h.stub("format.a") }));
vi.mock("./browserCommands", () => ({ registerBrowserCommands: h.stub("browser.a") }));
// An OWNER batch that runs BEFORE the throwing registrar, so the failure lands
// after a replace-own has already torn the previous batch out (audit #453).
vi.mock("./tabCommands", () => ({
  registerTabCommands: () =>
    h.bus.registerCommands("tab-commands", [{ id: "tab.a", title: "tab v2", run: () => {} }]),
}));
vi.mock("./fileCommands", () => ({ registerFileCommands: h.stub("file.a") }));
vi.mock("./genieCommands", () => ({
  registerGenieCommands: () => {
    h.stub("genie.a")();
    if (h.flags.genieThrows) throw new Error("genie boom");
  },
}));
vi.mock("./editorCommandBridge", () => ({
  registerEditorCommands: () =>
    h.bus.registerCommands("editor-commands", [{ id: "editor.a", title: "editor", run: () => {} }]),
}));

import { registerAllCommands } from "./registerAllCommands";
import {
  getCommand,
  listCommands,
  registerCommand,
  registerCommands,
  _resetCommandBus,
} from "./CommandBus";

const ids = () => listCommands().map((c) => c.id).sort();

beforeEach(() => {
  _resetCommandBus();
  h.flags.genieThrows = false;
});

describe("registerAllCommands", () => {
  it("registers every group and returns the editor batch's disposer", () => {
    const dispose = registerAllCommands();
    expect(ids()).toContain("misc.a");
    expect(ids()).toContain("genie.a");
    expect(ids()).toContain("editor.a");
    dispose();
    expect(ids()).not.toContain("editor.a");
    expect(ids()).toContain("misc.a");
  });

  it("rolls back every command the batch added when a registrar throws, so a retry starts clean", () => {
    h.flags.genieThrows = true;
    expect(() => registerAllCommands()).toThrow("genie boom");
    // Nothing partial survives — not the groups before the failure, and not
    // the failing group's own first command.
    expect(ids()).toEqual([]);

    h.flags.genieThrows = false;
    expect(() => registerAllCommands()).not.toThrow();
    expect(ids()).toContain("misc.a");
    expect(ids()).toContain("genie.a");
    expect(ids()).toContain("editor.a");
  });

  it("leaves commands registered BEFORE the batch untouched on rollback", () => {
    registerCommand({ id: "pre.existing", title: "pre", run: () => {} });
    h.flags.genieThrows = true;
    expect(() => registerAllCommands()).toThrow("genie boom");
    expect(ids()).toEqual(["pre.existing"]);
  });

  // Round 3: the snapshot was a set of IDs, so rollback could only DELETE. A
  // registrar that re-registers an owner batch (`registerCommands`) replaces
  // the previous one first — ids removed, then re-added under a fresh token —
  // and an id-only rollback cannot tell that apart from "was already there".
  // The bus therefore kept the failed attempt's definitions and its new
  // generation, and the disposer the previous batch had handed out no longer
  // matched, so nothing could take them off again.
  it("restores the DEFINITIONS an owner batch replaced before the failure", () => {
    const disposePrevious = registerCommands("tab-commands", [
      { id: "tab.a", title: "tab v1", run: () => {} },
    ]);
    h.flags.genieThrows = true;
    expect(() => registerAllCommands()).toThrow("genie boom");

    // Not merely "tab.a still exists" — the ORIGINAL definition is back.
    expect(getCommand("tab.a")?.title).toBe("tab v1");
    // And the pre-batch disposer still owns it: the failed attempt's token
    // must not have survived the rollback.
    disposePrevious();
    expect(ids()).toEqual([]);
  });
});
