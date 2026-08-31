// WI-TS3.1 — the tab bar renders the VISIBLE population (plan invariant 7):
// active scope ∪ window-scoped with the rail on, everything with it off
// (invariant 4), the + gate counts the visible union (D-T5), and a created
// session is stamped through the ONE shared resolver (D-T1).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, fireEvent } from "@testing-library/react";
import { TerminalTabBar } from "./TerminalTabBar";
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

function renderBar() {
  return render(
    <TerminalTabBar onClose={vi.fn()} onRestart={vi.fn()} position="bottom" />,
  );
}

const tabCount = (container: HTMLElement) =>
  container.querySelectorAll(".terminal-tab").length;

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

describe("TerminalTabBar — scoped rendering (WI-TS3.1)", () => {
  it("renders only the visible population: active scope ∪ window-scoped", () => {
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" });
    useUIStore.getState().terminalCreateSession(); // window-scoped

    const { container } = renderBar();

    expect(tabCount(container)).toBe(3); // 2×A + 1 window-scoped; B hidden
  });

  it("rail OFF renders ALL sessions, stamped included (invariant 4)", () => {
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" });
    useUIStore.getState().terminalCreateSession();
    setRail(false);

    const { container } = renderBar();

    expect(tabCount(container)).toBe(3);
  });

  it("re-renders the swap on a rail switch (store-driven)", () => {
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-b" });
    const { container } = renderBar();
    expect(tabCount(container)).toBe(2); // A's pair

    act(() => {
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    });

    expect(tabCount(container)).toBe(1); // B's single tab
  });

  it("isMaxed gates on the VISIBLE union: a full hidden scope frees nothing, an empty scope frees the +", () => {
    for (let i = 0; i < 5; i++) {
      useUIStore.getState().terminalCreateSession({ ownerInstanceId: "wsi-a" });
    }
    const { container } = renderBar();
    const plus = () =>
      container.querySelector<HTMLButtonElement>('[data-terminal-action="new"]');
    expect(plus()?.disabled).toBe(true);

    act(() => {
      useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    });
    expect(plus()?.disabled).toBe(false);
  });

  it("+ stamps the created session with the active scope (D-T1)", () => {
    const { container } = renderBar();
    const plus = container.querySelector<HTMLButtonElement>(
      '[data-terminal-action="new"]',
    );
    fireEvent.click(plus!);

    const created = useUIStore.getState().terminal.sessions[0];
    expect(created?.workspaceInstanceId).toBe("wsi-a");
  });
});
