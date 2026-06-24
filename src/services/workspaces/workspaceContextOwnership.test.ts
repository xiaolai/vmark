import { beforeEach, describe, expect, it } from "vitest";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import type { WorkspaceInstanceRecord } from "@/stores/workspaceInstancesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  selectWindowWorkspaceState,
  useWorkspaceInstancesStore,
} from "@/stores/workspaceInstancesStore";
import {
  claimTabForWorkspaceContext,
  classifyWorkspaceContextForTab,
  orderedWindowInstances,
} from "./workspaceContextOwnership";

function workspaceInstance(
  workspaceInstanceId: string,
  rootPath: string,
  ownerWindowLabel = "main",
): WorkspaceInstanceRecord {
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
  if (!root.ok) throw new Error("test root should be valid");
  return createWorkspaceInstance({
    workspaceInstanceId,
    root: root.root,
    ownerWindowLabel,
    createdFrom: "open",
  });
}

function looseInstance(workspaceInstanceId = "wsi-loose"): WorkspaceInstanceRecord {
  return createWorkspaceInstance({
    workspaceInstanceId,
    root: null,
    ownerWindowLabel: "main",
    createdFrom: "open",
    kind: "loose",
  });
}

describe("classifyWorkspaceContextForTab", () => {
  it("routes untitled tabs to loose files", () => {
    const loose = looseInstance();

    expect(
      classifyWorkspaceContextForTab({
        filePath: null,
        instances: [workspaceInstance("wsi-repo", "/repo"), loose],
        activeWorkspaceInstanceId: "wsi-repo",
      })?.workspaceInstanceId,
    ).toBe("wsi-loose");
  });

  it("routes outside-workspace files to loose files", () => {
    const loose = looseInstance();

    expect(
      classifyWorkspaceContextForTab({
        filePath: "/other/note.md",
        instances: [workspaceInstance("wsi-repo", "/repo"), loose],
        activeWorkspaceInstanceId: "wsi-repo",
      })?.workspaceInstanceId,
    ).toBe("wsi-loose");
  });

  it("routes files inside a workspace to that workspace", () => {
    expect(
      classifyWorkspaceContextForTab({
        filePath: "/repo/docs/note.md",
        instances: [workspaceInstance("wsi-repo", "/repo"), looseInstance()],
        activeWorkspaceInstanceId: "wsi-loose",
      })?.workspaceInstanceId,
    ).toBe("wsi-repo");
  });

  it("chooses the most specific nested workspace root", () => {
    expect(
      classifyWorkspaceContextForTab({
        filePath: "/repo/docs/note.md",
        instances: [
          workspaceInstance("wsi-repo", "/repo"),
          workspaceInstance("wsi-docs", "/repo/docs"),
          looseInstance(),
        ],
        activeWorkspaceInstanceId: "wsi-repo",
      })?.workspaceInstanceId,
    ).toBe("wsi-docs");
  });

  it("uses the active same-root context before rail order", () => {
    expect(
      classifyWorkspaceContextForTab({
        filePath: "/repo/note.md",
        instances: [
          workspaceInstance("wsi-first", "/repo"),
          workspaceInstance("wsi-second", "/repo"),
          looseInstance(),
        ],
        activeWorkspaceInstanceId: "wsi-second",
      })?.workspaceInstanceId,
    ).toBe("wsi-second");
  });

  it("ignores placeholders as owners", () => {
    const placeholder = createWorkspaceInstance({
      workspaceInstanceId: "wsi-placeholder",
      root: null,
      ownerWindowLabel: "main",
      createdFrom: "placeholder",
    });

    expect(
      classifyWorkspaceContextForTab({
        filePath: "/loose.md",
        instances: [placeholder],
        activeWorkspaceInstanceId: "wsi-placeholder",
      }),
    ).toBeNull();
  });

  it("falls back to rail order when same-root contexts are not active", () => {
    expect(
      classifyWorkspaceContextForTab({
        filePath: "/repo/note.md",
        instances: [
          workspaceInstance("wsi-first", "/repo"),
          workspaceInstance("wsi-second", "/repo"),
          looseInstance(),
        ],
        activeWorkspaceInstanceId: "wsi-missing",
      })?.workspaceInstanceId,
    ).toBe("wsi-first");
  });
});

describe("workspace context tab claims", () => {
  beforeEach(() => {
    useSettingsStore.getState().resetSettings();
    useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  });

  it("does nothing while workspace rail mode is disabled", () => {
    expect(claimTabForWorkspaceContext("main", "tab-a", "/repo/a.md")).toBeNull();
    expect(orderedWindowInstances("main")).toEqual([]);
  });

  it("creates a loose context for the first unowned tab claim", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);

    const owner = claimTabForWorkspaceContext("main", "tab-a", null);

    expect(owner).toMatchObject({ kind: "loose" });
    expect(useWorkspaceInstancesStore.getState().instances[owner!.workspaceInstanceId])
      .toMatchObject({ tabIds: ["tab-a"], activeTabId: "tab-a" });
    expect(
      selectWindowWorkspaceState(useWorkspaceInstancesStore.getState(), "main")
        ?.activeWorkspaceInstanceId,
    ).toBe(owner?.workspaceInstanceId);
  });

  it("moves a tab from its previous context into the matched workspace", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
    const store = useWorkspaceInstancesStore.getState();
    store.addWorkspaceInstance(workspaceInstance("wsi-repo", "/repo"));
    const loose = store.ensureLooseInstance("main");
    store.setWorkspaceInstanceTabs(loose.workspaceInstanceId, ["tab-a"], "tab-a");

    const owner = claimTabForWorkspaceContext("main", "tab-a", "/repo/a.md");

    expect(owner?.workspaceInstanceId).toBe("wsi-repo");
    expect(useWorkspaceInstancesStore.getState().instances["wsi-repo"]).toMatchObject({
      tabIds: ["tab-a"],
      activeTabId: "tab-a",
    });
    expect(useWorkspaceInstancesStore.getState().instances[loose.workspaceInstanceId].tabIds)
      .toEqual([]);
  });

  it("creates a loose owner when no workspace can own the file", () => {
    useSettingsStore.getState().updateGeneralSetting("workspaceRailMode", true);
    useWorkspaceInstancesStore.getState().addWorkspaceInstance(
      workspaceInstance("wsi-repo", "/repo"),
    );

    expect(claimTabForWorkspaceContext("main", "tab-a", "/other/a.md"))
      .toMatchObject({ kind: "loose" });

    const state = useWorkspaceInstancesStore.getState();
    const looseId = state.windows.main.workspaceInstanceIds.find(
      (id) => state.instances[id]?.kind === "loose",
    );
    expect(looseId).toBeDefined();
  });
});
