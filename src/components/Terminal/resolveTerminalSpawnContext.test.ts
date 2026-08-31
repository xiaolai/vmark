// @vitest-environment node
// WI-TS4.1 — the spawn env/cwd contract (D-T9), table-driven over the full
// matrix: requestedCwd / same-scope sibling / stamped owner present / owner
// deleted / unscoped / loose-with-file. Real stores; the sibling-cwd accessor
// is the injected seam (it stands for the live xterm entries).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { resetTerminalSessionStore, useUIStore } from "@/stores/uiStore";
import {
  createWorkspaceInstance,
  createWorkspaceRootIdentity,
} from "@/utils/workspaceIdentity";
import { resolveTerminalSpawnContext } from "./resolveTerminalSpawnContext";

const W = "main";
const noSiblings = () => undefined;

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

const create = (options?: Parameters<
  ReturnType<typeof useUIStore.getState>["terminalCreateSession"]
>[0]) => useUIStore.getState().terminalCreateSession(options)!;

beforeEach(() => {
  resetTerminalSessionStore();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.getState().closeWorkspace();
  useTabStore.setState({ tabs: {}, activeTabId: {}, untitledCounter: 0 });
  useDocumentStore.setState({ documents: {} });
  setRail(true);
  addWorkspace("wsi-a", "/repo-a");
  addWorkspace("wsi-b", "/repo-b");
  useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-a");
});

afterEach(() => {
  setRail(false);
});

describe("resolveTerminalSpawnContext (WI-TS4.1, D-T9)", () => {
  it("requestedCwd outranks everything, while workspaceRoot stays the owner's", () => {
    const s = create({ ownerInstanceId: "wsi-a", requestedCwd: "/asked/for" });
    const ctx = resolveTerminalSpawnContext(W, s, () => "/sibling/cwd");
    expect(ctx).toEqual({ cwd: "/asked/for", workspaceRoot: "/repo-a" });
  });

  it("inherits a SAME-scope sibling's live cwd", () => {
    const sib = create({ ownerInstanceId: "wsi-a" });
    const s = create({ ownerInstanceId: "wsi-a" });
    const ctx = resolveTerminalSpawnContext(W, s, (id) =>
      id === sib.id ? "/repo-a/sub" : undefined,
    );
    expect(ctx).toEqual({ cwd: "/repo-a/sub", workspaceRoot: "/repo-a" });
  });

  it("ignores an OTHER-scope sibling's cwd (D-T9: scope-narrowed inheritance)", () => {
    const other = create({ ownerInstanceId: "wsi-b" });
    const s = create({ ownerInstanceId: "wsi-a" });
    const ctx = resolveTerminalSpawnContext(W, s, (id) =>
      id === other.id ? "/repo-b/somewhere" : undefined,
    );
    expect(ctx).toEqual({ cwd: "/repo-a", workspaceRoot: "/repo-a" });
  });

  it("stamped owner present: owner's root wins EVEN when another scope is active (mid-switch)", () => {
    const s = create({ ownerInstanceId: "wsi-a" });
    useWorkspaceInstancesStore.getState().activateWorkspaceInstance(W, "wsi-b");
    const ctx = resolveTerminalSpawnContext(W, s, noSiblings);
    expect(ctx).toEqual({ cwd: "/repo-a", workspaceRoot: "/repo-a" });
  });

  it("owner deleted mid-spawn: falls back to the active scope (degenerate case)", () => {
    const s = create({ ownerInstanceId: "wsi-ghost" });
    const ctx = resolveTerminalSpawnContext(W, s, noSiblings);
    expect(ctx).toEqual({ cwd: "/repo-a", workspaceRoot: "/repo-a" });
  });

  it("unscoped session: active-scope resolution as today", () => {
    const s = create();
    const ctx = resolveTerminalSpawnContext(W, s, noSiblings);
    expect(ctx).toEqual({ cwd: "/repo-a", workspaceRoot: "/repo-a" });
  });

  it("loose-with-file: no root, so the active saved file's parent anchors the cwd", () => {
    const loose = useWorkspaceInstancesStore.getState().ensureLooseInstance(W);
    const tabId = useTabStore.getState().createTab(W, "/notes/dir/saved.md");
    useDocumentStore
      .getState()
      .initDocument(tabId, "x", "/notes/dir/saved.md", { savedContent: "x" });
    useTabStore.getState().setActiveTab(W, tabId);
    const s = create({ ownerInstanceId: loose.workspaceInstanceId });

    const ctx = resolveTerminalSpawnContext(W, s, noSiblings);

    expect(ctx).toEqual({ cwd: "/notes/dir" });
    expect(ctx.workspaceRoot).toBeUndefined();
  });

  it("undefined session (mid-teardown): unscoped default, no request, no sibling walk", () => {
    const ctx = resolveTerminalSpawnContext(W, undefined, () => "/never");
    expect(ctx).toEqual({ cwd: "/repo-a", workspaceRoot: "/repo-a" });
  });
});
