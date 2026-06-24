import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getRuntimePlatform } from "@/utils/platform";
import type { WorkspaceInstanceRecord } from "@/stores/workspaceInstancesStore";
import { getActiveWorkspaceScope, buildActiveWorkspaceScope } from "./activeWorkspaceScope";

const storage = new Map<string, string>();

function installLocalStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => Array.from(storage.keys())[index] ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  });
}

function config(excludeFolders: string[]): WorkspaceConfig {
  return {
    version: 1,
    excludeFolders,
    lastOpenTabs: [],
    showHiddenFiles: false,
    showAllFiles: false,
  };
}

function addInstance(
  workspaceInstanceId: string,
  rootPath: string,
  ownerWindowLabel = "main",
): void {
  // Use the runtime platform so the instance rootId matches the legacy rootId
  // that getActiveWorkspaceScope resolves (both derive from getRuntimePlatform).
  const root = createWorkspaceRootIdentity(rootPath, { platform: getRuntimePlatform() });
  if (!root.ok) throw new Error("test root should be valid");
  useWorkspaceInstancesStore.getState().addWorkspaceInstance(
    createWorkspaceInstance({
      workspaceInstanceId,
      root: root.root,
      ownerWindowLabel,
      createdFrom: "open",
    }),
  );
}

beforeEach(() => {
  installLocalStorage();
  storage.clear();
  useWorkspaceInstancesStore.getState().resetWorkspaceInstances();
  useWorkspaceStore.setState({
    rootPath: null,
    config: null,
    isWorkspaceMode: false,
  });
  useSettingsStore.setState({
    general: {
      ...useSettingsStore.getState().general,
      workspaceRailMode: false,
    },
  });
});

describe("getActiveWorkspaceScope", () => {
  it("returns the legacy window workspace while rail mode is disabled", () => {
    useWorkspaceStore.setState({
      rootPath: "/Users/xiaolai/legacy",
      config: config(["dist"]),
      isWorkspaceMode: true,
    });
    addInstance("wsi-active", "/Users/xiaolai/instance");

    expect(getActiveWorkspaceScope("main")).toMatchObject({
      source: "legacy",
      workspaceInstanceId: null,
      rootPath: "/Users/xiaolai/legacy",
      isWorkspaceMode: true,
      excludeFolders: ["dist"],
    });
  });

  it("returns the active workspace instance when rail mode is enabled", () => {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: true,
      },
    });
    useWorkspaceStore.setState({
      rootPath: "/Users/xiaolai/project",
      config: config(["node_modules", "dist"]),
      isWorkspaceMode: true,
    });
    addInstance("wsi-project", "/Users/xiaolai/project");

    expect(getActiveWorkspaceScope("main")).toMatchObject({
      source: "instance",
      workspaceInstanceId: "wsi-project",
      rootPath: "/Users/xiaolai/project",
      isWorkspaceMode: true,
      excludeFolders: ["node_modules", "dist"],
    });
  });

  it("does not leak another window's active instance", () => {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: true,
      },
    });
    useWorkspaceStore.setState({
      rootPath: "/Users/xiaolai/main",
      config: config(["cache"]),
      isWorkspaceMode: true,
    });
    addInstance("wsi-doc", "/Users/xiaolai/doc", "doc-1");

    expect(getActiveWorkspaceScope("main")).toMatchObject({
      source: "legacyFallback",
      workspaceInstanceId: null,
      rootPath: "/Users/xiaolai/main",
      excludeFolders: ["cache"],
    });
  });

  it("treats an active placeholder as an empty workspace scope", () => {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: true,
      },
    });
    useWorkspaceStore.setState({
      rootPath: "/Users/xiaolai/legacy",
      config: config(["legacy"]),
      isWorkspaceMode: true,
    });
    useWorkspaceInstancesStore.getState().ensurePlaceholderInstance("main", "wsi-placeholder");

    expect(getActiveWorkspaceScope("main")).toMatchObject({
      source: "instance",
      workspaceInstanceId: "wsi-placeholder",
      rootPath: null,
      isWorkspaceMode: false,
      excludeFolders: [],
    });
  });

  it("does not reuse legacy excluded folders for a different active root", () => {
    useSettingsStore.setState({
      general: {
        ...useSettingsStore.getState().general,
        workspaceRailMode: true,
      },
    });
    useWorkspaceStore.setState({
      rootPath: "/Users/xiaolai/legacy",
      config: config(["legacy-only"]),
      isWorkspaceMode: true,
    });
    addInstance("wsi-project", "/Users/xiaolai/project");

    expect(getActiveWorkspaceScope("main")).toMatchObject({
      rootPath: "/Users/xiaolai/project",
      excludeFolders: [],
    });
  });
});

function instance(over: Partial<WorkspaceInstanceRecord>): WorkspaceInstanceRecord {
  return {
    workspaceInstanceId: "wsi",
    kind: "workspace",
    rootId: "root-id",
    rootPath: "/Users/xiaolai/project",
    displayName: "project",
    ownerWindowLabel: "main",
    createdFrom: "open",
    activeTabId: null,
    tabIds: [],
    closedTabIds: [],
    ...over,
  };
}

describe("buildActiveWorkspaceScope", () => {
  it("returns legacy scope when rail is disabled", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: false,
        legacyRootPath: "/Users/xiaolai/legacy",
        legacyConfig: config(["dist"]),
        legacyMode: true,
        activeInstance: instance({ rootPath: "/Users/xiaolai/other" }),
      }),
    ).toMatchObject({
      source: "legacy",
      kind: "legacy",
      workspaceInstanceId: null,
      rootPath: "/Users/xiaolai/legacy",
      isWorkspaceMode: true,
      excludeFolders: ["dist"],
    });
  });

  it("falls back to legacy when rail is enabled but no active instance", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/main",
        legacyConfig: config(["cache"]),
        legacyMode: true,
        activeInstance: null,
      }),
    ).toMatchObject({
      source: "legacyFallback",
      kind: "legacy",
      rootPath: "/Users/xiaolai/main",
      excludeFolders: ["cache"],
    });
  });

  it("returns the active instance scope, reusing legacy config only on matching root", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/project",
        legacyConfig: config(["node_modules"]),
        legacyMode: true,
        activeInstance: instance({
          workspaceInstanceId: "wsi-project",
          rootPath: "/Users/xiaolai/project",
        }),
      }),
    ).toMatchObject({
      source: "instance",
      kind: "workspace",
      workspaceInstanceId: "wsi-project",
      rootPath: "/Users/xiaolai/project",
      isWorkspaceMode: true,
      excludeFolders: ["node_modules"],
    });
  });

  it("does not reuse legacy config for a mismatched active root", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/legacy",
        legacyConfig: config(["legacy-only"]),
        legacyMode: true,
        activeInstance: instance({ rootPath: "/Users/xiaolai/project" }),
      }),
    ).toMatchObject({
      rootPath: "/Users/xiaolai/project",
      excludeFolders: [],
    });
  });

  it("treats a placeholder instance as an empty (non-workspace) scope", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/legacy",
        legacyConfig: config(["legacy"]),
        legacyMode: true,
        activeInstance: instance({
          workspaceInstanceId: "wsi-placeholder",
          kind: "placeholder",
          rootPath: null,
        }),
      }),
    ).toMatchObject({
      source: "instance",
      kind: "placeholder",
      rootPath: null,
      isWorkspaceMode: false,
      excludeFolders: [],
    });
  });

  it("reuses legacy config when the active instance matches by normalized rootId, not raw path", () => {
    // Active instance has a trailing separator and shares the legacy rootId.
    // String equality would fail; identity equality must still reuse config.
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/project",
        legacyRootId: "path:macos:/Users/xiaolai/project",
        legacyConfig: config(["node_modules"]),
        legacyMode: true,
        activeInstance: instance({
          workspaceInstanceId: "wsi-project",
          rootPath: "/Users/xiaolai/project/",
          rootId: "path:macos:/Users/xiaolai/project",
        }),
      }),
    ).toMatchObject({
      source: "instance",
      excludeFolders: ["node_modules"],
    });
  });

  it("does not reuse legacy config when rootIds differ even if paths look similar", () => {
    expect(
      buildActiveWorkspaceScope({
        windowLabel: "main",
        railEnabled: true,
        legacyRootPath: "/Users/xiaolai/project",
        legacyRootId: "path:macos:/Users/xiaolai/project",
        legacyConfig: config(["legacy-only"]),
        legacyMode: true,
        activeInstance: instance({
          workspaceInstanceId: "wsi-other",
          rootPath: "/Users/xiaolai/other",
          rootId: "path:macos:/Users/xiaolai/other",
        }),
      }),
    ).toMatchObject({
      excludeFolders: [],
    });
  });
});
