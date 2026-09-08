// @vitest-environment node
/**
 * Audit #944 — both explorer toggles used to be listed in the palette and
 * executable with no workspace open, where `updateWorkspaceConfig` refuses
 * without a message and they did nothing at all. The `when` predicate answers
 * the click: the palette hides them and the dispatch is refused.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const toggleHidden = vi.fn();
const toggleAll = vi.fn();
vi.mock("@/services/workspaces/workspaceConfig", () => ({
  toggleShowHiddenFiles: () => toggleHidden(),
  toggleShowAllFiles: () => toggleAll(),
}));

import { executeCommand, searchCommands, _resetCommandBus } from "./CommandBus";
import { registerExplorerCommands } from "./explorerCommands";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { normalizeWorkspaceConfig } from "@/stores/workspaceConfigDefaults";

const IDS = ["explorer.toggleHiddenFiles", "explorer.toggleAllFiles"] as const;

beforeEach(() => {
  _resetCommandBus();
  toggleHidden.mockReset().mockResolvedValue(true);
  toggleAll.mockReset().mockResolvedValue(true);
  useWorkspaceStore.setState({ rootPath: null, config: null, isWorkspaceMode: false });
  registerExplorerCommands();
});

afterEach(() => _resetCommandBus());

/** Put the store in the shape `updateWorkspaceConfig` requires. */
function openWorkspace() {
  useWorkspaceStore.setState({
    rootPath: "/ws",
    config: normalizeWorkspaceConfig(null),
    isWorkspaceMode: true,
  });
}

describe("explorer toggles without a workspace (#944)", () => {
  it.each(IDS)("%s is hidden from the palette and refused", async (id) => {
    expect(searchCommands("", {}).map((r) => r.command.id)).not.toContain(id);
    await expect(executeCommand(id, undefined, { windowLabel: "main" })).resolves.toBe(false);
    expect(toggleHidden).not.toHaveBeenCalled();
    expect(toggleAll).not.toHaveBeenCalled();
  });

  it("stays refused when workspace mode is on but the config never loaded", async () => {
    useWorkspaceStore.setState({ rootPath: "/ws", config: null, isWorkspaceMode: true });
    await expect(executeCommand(IDS[0], undefined, { windowLabel: "main" })).resolves.toBe(false);
  });
});

describe("explorer toggles with a workspace open", () => {
  it.each(IDS)("%s is listed and runs", async (id) => {
    openWorkspace();
    expect(searchCommands("", {}).map((r) => r.command.id)).toContain(id);
    await expect(executeCommand(id, undefined, { windowLabel: "main" })).resolves.toBe(true);
  });

  it("dispatches to the matching toggle", async () => {
    openWorkspace();
    await executeCommand(IDS[0], undefined, { windowLabel: "main" });
    expect(toggleHidden).toHaveBeenCalledTimes(1);
    expect(toggleAll).not.toHaveBeenCalled();

    await executeCommand(IDS[1], undefined, { windowLabel: "main" });
    expect(toggleAll).toHaveBeenCalledTimes(1);
  });
});
