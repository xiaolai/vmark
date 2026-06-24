import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { useWorkspaceStore, type WorkspaceConfig } from "@/stores/workspaceStore";
import { useWorkspaceInstancesStore } from "@/stores/workspaceInstancesStore";
import { createWorkspaceInstance, createWorkspaceRootIdentity } from "@/utils/workspaceIdentity";
import { getActiveWorkspaceScope } from "./activeWorkspaceScope";

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
  const root = createWorkspaceRootIdentity(rootPath, { platform: "macos" });
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
