// WI-TS3.1 — Cmd+1..5 positional switching indexes the VISIBLE population
// (plan invariant 7): a hidden scope's session is not addressable; rail off
// addresses everything (invariant 4).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { createTerminalKeyHandler } from "./terminalKeyHandler";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";

vi.mock("@/services/persistence/workspaceStorage", () => ({
  getCurrentWindowLabel: () => "main",
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: vi.fn().mockResolvedValue(""),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

const W = "main";

function setRail(enabled: boolean): void {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, workspaceRailMode: enabled },
  });
}

function addWorkspace(id: string, rootPath: string): void {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("bad test root");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId: id,
      root: root.root,
      ownerWindowLabel: W,
      createdFrom: "open",
    }),
  );
}

function makeHandler() {
  const term = {
    hasSelection: () => false,
    getSelection: () => "",
    clearSelection: vi.fn(),
    clear: vi.fn(),
    paste: vi.fn(),
    selectAll: vi.fn(),
  } as unknown as Terminal;
  return createTerminalKeyHandler(term, { current: null }, {
    onSearch: vi.fn(),
    isComposing: () => false,
  });
}

function pressCmd(handler: (e: KeyboardEvent) => boolean, key: string): void {
  handler(
    new KeyboardEvent("keydown", { key, metaKey: true, cancelable: true }),
  );
}

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

afterEach(() => {
  setRail(false);
});

describe("terminalKeyHandler — Cmd+N over the visible population (WI-TS3.1)", () => {
  it("Cmd+2 activates the SECOND VISIBLE session, skipping a hidden scope's", () => {
    const a1 = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    const b1 = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    const a2 = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    useUIStore.getState().terminalSetActiveSession(a1.id);

    pressCmd(makeHandler(), "2");

    // Visible order is [a1, a2]; b1 (store position 2) is not addressable.
    expect(useUIStore.getState().terminal.activeSessionId).toBe(a2.id);
    expect(useUIStore.getState().terminal.activeSessionId).not.toBe(b1.id);
  });

  it("an index past the visible population is a no-op even when the store has more", () => {
    const a1 = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" })!;
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" });
    useUIStore.getState().terminalSetActiveSession(a1.id);

    pressCmd(makeHandler(), "2"); // visible has 1 entry; store has 2

    expect(useUIStore.getState().terminal.activeSessionId).toBe(a1.id);
  });

  it("rail OFF addresses every session by store order (invariant 4)", () => {
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    const b1 = useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" })!;
    setRail(false);

    pressCmd(makeHandler(), "2");

    expect(useUIStore.getState().terminal.activeSessionId).toBe(b1.id);
  });
});
