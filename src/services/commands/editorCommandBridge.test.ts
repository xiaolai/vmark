// @vitest-environment node
/**
 * Editor-command bridge tests — command-registry WI-3.1/3.2/3.4 (Phase 3).
 *
 * @module services/commands/editorCommandBridge.test
 */
import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/services/editor/runEditorAction", () => ({ runEditorAction: vi.fn() }));
vi.mock("./actionAvailability", () => ({ actionAvailability: vi.fn(() => true) }));
vi.mock("@/i18n", () => ({
  default: { t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key },
}));

import {
  buildEditorCommandSpecs,
  registerEditorCommands,
  EDITOR_COMMANDS_OWNER,
} from "./editorCommandBridge";
import { runEditorAction } from "@/services/editor/runEditorAction";
import { actionAvailability } from "./actionAvailability";
import { ACTION_DEFINITIONS } from "@/plugins/actions/actionRegistry";
import {
  searchCommands,
  executeCommand,
  registerCommand,
  _resetCommandBus,
  type CommandDefinition,
} from "./CommandBus";

const CTX = { windowLabel: "main" };

function specById(id: string): CommandDefinition {
  const spec = buildEditorCommandSpecs().find((s) => s.id === id);
  if (!spec) throw new Error(`no spec ${id}`);
  return spec;
}

beforeEach(() => {
  _resetCommandBus();
  vi.clearAllMocks();
});

describe("buildEditorCommandSpecs", () => {
  it("builds one spec per ActionId, projecting setHeading to six heading rows", () => {
    const specs = buildEditorCommandSpecs();
    const nonHeadingCount = Object.keys(ACTION_DEFINITIONS).length - 1; // minus setHeading
    expect(specs).toHaveLength(nonHeadingCount + 6);
    // Exactly six setHeading rows, ids editor.setHeading.1..6, and NO plain one.
    const headingIds = specs.map((s) => s.id).filter((id) => id.startsWith("editor.setHeading"));
    expect(headingIds.sort()).toEqual([
      "editor.setHeading.1",
      "editor.setHeading.2",
      "editor.setHeading.3",
      "editor.setHeading.4",
      "editor.setHeading.5",
      "editor.setHeading.6",
    ]);
    expect(specs.find((s) => s.id === "editor.setHeading")).toBeUndefined();
  });

  it("every spec id is namespaced under editor.* (no collision with view/file/workspace ids)", () => {
    for (const spec of buildEditorCommandSpecs()) {
      expect(spec.id).toMatch(/^editor\./);
    }
  });

  it("carries the ActionDefinition category", () => {
    expect(specById("editor.bold").category).toBe(ACTION_DEFINITIONS.bold.category);
    expect(specById("editor.insertTable").category).toBe(ACTION_DEFINITIONS.insertTable.category);
  });

  it("title resolves through i18n (falling back to the English label)", () => {
    expect(
      (specById("editor.bold").title as () => string)(),
    ).toBe("Bold");
    expect(
      (specById("editor.setHeading.2").title as () => string)(),
    ).toBe("Heading 2");
  });

  it("run calls the ONE executor with the ActionId (+ level for heading rows)", () => {
    specById("editor.bold").run(null, CTX);
    expect(runEditorAction).toHaveBeenCalledWith("bold", { windowLabel: "main", params: undefined });

    vi.mocked(runEditorAction).mockClear();
    specById("editor.setHeading.3").run(null, CTX);
    expect(runEditorAction).toHaveBeenCalledWith("setHeading", { windowLabel: "main", params: { level: 3 } });
  });

  it("when calls actionAvailability with the ActionId (setHeading rows share the id)", () => {
    specById("editor.bold").when?.(CTX);
    expect(actionAvailability).toHaveBeenCalledWith("bold", CTX);

    vi.mocked(actionAvailability).mockClear();
    specById("editor.setHeading.4").when?.(CTX);
    expect(actionAvailability).toHaveBeenCalledWith("setHeading", CTX);
  });
});

describe("registerEditorCommands + palette search (DoD)", () => {
  it("registers the batch under the bridge owner and makes actions searchable", () => {
    registerEditorCommands();
    // Searching returns runnable commands whose run reaches the executor.
    const bold = searchCommands("bold", CTX).find((r) => r.command.id === "editor.bold");
    expect(bold).toBeDefined();
    bold!.command.run(null, CTX);
    expect(runEditorAction).toHaveBeenCalledWith("bold", { windowLabel: "main", params: undefined });

    expect(searchCommands("insert table", CTX).some((r) => r.command.id === "editor.insertTable")).toBe(true);
    expect(searchCommands("heading 2", CTX).some((r) => r.command.id === "editor.setHeading.2")).toBe(true);
  });

  it("executeCommand runs a registered editor command through the full bus path", async () => {
    registerEditorCommands();
    const ran = await executeCommand("editor.setHeading.2", null, CTX);
    expect(ran).toBe(true);
    expect(runEditorAction).toHaveBeenCalledWith("setHeading", { windowLabel: "main", params: { level: 2 } });
  });

  it("executeCommand refuses an unavailable editor command (when → actionAvailability)", async () => {
    vi.mocked(actionAvailability).mockReturnValue(false);
    registerEditorCommands();
    expect(await executeCommand("editor.bold", null, CTX)).toBe(false);
    expect(runEditorAction).not.toHaveBeenCalled();
  });

  it("hides unavailable actions from search (when → actionAvailability)", () => {
    vi.mocked(actionAvailability).mockReturnValue(false);
    registerEditorCommands();
    expect(searchCommands("bold", CTX)).toHaveLength(0);
  });

  it("preflights a collision with an existing bus id and registers nothing", () => {
    registerCommand({ id: "editor.bold", title: "Bold (plain)", run: vi.fn() });
    expect(() => registerEditorCommands()).toThrow(/already registered/);
  });

  it("exposes a stable owner token", () => {
    expect(EDITOR_COMMANDS_OWNER).toBe("editor-actions");
  });
});
