// WI-AL4.1 — the Git export is reachable from the app: the composition root registers it
/**
 * The phase-4 gate's reachability fact, proven by running the real
 * composition root: `registerAllCommands()` (what the command bootstrap
 * calls) registers `history.exportToGit`, and running that command invokes
 * `agent_journal_git_export`. An export client nothing registers — a module
 * that merely spells the command — cannot satisfy it.
 *
 * Runs under jsdom, the default: registerAllCommands pulls in modules that
 * publish DEV debug handles on `window` at import time.
 *
 * @coordinates-with src/services/commands/registerAllCommands.ts — the composition root
 * @coordinates-with scripts/check-al-phase.sh — phase 4 reads this test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke, mockOpen } = vi.hoisted(() => ({ mockInvoke: vi.fn(), mockOpen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => mockInvoke(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => mockOpen(...a) }));

import { registerAllCommands } from "./registerAllCommands";
import { _resetCommandBus, executeCommand, hasCommand } from "./CommandBus";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";

beforeEach(() => {
  vi.clearAllMocks();
  _resetCommandBus();
  useTabStore.setState(useTabStore.getInitialState());
  useDocumentStore.setState(useDocumentStore.getInitialState());
});

describe("the Git export through the composition root", () => {
  it("registerAllCommands registers history.exportToGit, and running it invokes agent_journal_git_export", async () => {
    const dispose = registerAllCommands();
    try {
      expect(hasCommand("history.exportToGit")).toBe(true);
      const tabId = useTabStore.getState().createTab("main");
      useDocumentStore.getState().initDocument(tabId, "x", "/repo/notes.md");
      useTabStore.getState().setActiveTab("main", tabId);
      mockOpen.mockResolvedValue("/repo");
      mockInvoke.mockResolvedValue({ branch: "vmark-journal/x", head: null, commitsCreated: 0, syntheticCreated: 0 });

      await executeCommand("history.exportToGit", undefined, { windowLabel: "main" });

      expect(mockInvoke).toHaveBeenCalledWith("agent_journal_git_export", {
        payload: JSON.stringify({ docKey: "path:/repo/notes.md", repository: "/repo" }),
      });
    } finally {
      dispose();
    }
  });
});
