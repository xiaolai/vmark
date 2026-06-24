import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWorkspaceInstancesSnapshot,
  readWorkspaceInstancesSnapshot,
  writeWorkspaceInstancesSnapshot,
  WORKSPACE_INSTANCES_STORAGE_KEY,
} from "./workspaceInstancesStorage";
import type { HotExitWorkspaceInstanceState } from "./hotExit/types";

function makeSnapshot(instances: HotExitWorkspaceInstanceState[] = []) {
  return {
    version: 5,
    windows: [
      {
        window_label: "main",
        workspace_instance_ids: instances.map((instance) => instance.workspaceInstanceId),
        active_workspace_instance_id: instances[0]?.workspaceInstanceId ?? null,
      },
    ],
    instances,
  };
}

describe("workspace instances v5 local snapshot storage", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    localStorage.clear();
  });

  it("returns null when no snapshot exists", () => {
    expect(readWorkspaceInstancesSnapshot()).toEqual({ ok: true, snapshot: null });
  });

  it("round-trips a multiple-instance window snapshot", () => {
    const snapshot = makeSnapshot([
      {
        workspaceInstanceId: "ws-1",
        kind: "workspace",
        rootId: "path:macos:/tmp/a",
        rootPath: "/tmp/a",
        displayName: "a",
        ownerWindowLabel: "main",
        createdFrom: "open",
        activeTabId: null,
        tabIds: ["tab-1"],
        closedTabIds: [],
      },
      {
        workspaceInstanceId: "ws-2",
        kind: "workspace",
        rootId: "path:macos:/tmp/a",
        rootPath: "/tmp/a",
        displayName: "a",
        ownerWindowLabel: "main",
        createdFrom: "duplicate",
        activeTabId: null,
        tabIds: [],
        closedTabIds: [],
      },
    ]);

    expect(writeWorkspaceInstancesSnapshot(snapshot)).toEqual({ ok: true });
    expect(readWorkspaceInstancesSnapshot()).toEqual({ ok: true, snapshot });
  });

  it("reports corrupt JSON without deleting the stored payload", () => {
    localStorage.setItem(WORKSPACE_INSTANCES_STORAGE_KEY, "{bad json");

    expect(readWorkspaceInstancesSnapshot()).toEqual({
      ok: false,
      error: "corrupt",
    });
    expect(localStorage.getItem(WORKSPACE_INSTANCES_STORAGE_KEY)).toBe("{bad json");
  });

  it("reports invalid snapshot shape", () => {
    localStorage.setItem(WORKSPACE_INSTANCES_STORAGE_KEY, JSON.stringify({ version: 4 }));

    expect(readWorkspaceInstancesSnapshot()).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("reports invalid primitive and invalid window entries", () => {
    localStorage.setItem(WORKSPACE_INSTANCES_STORAGE_KEY, "null");
    expect(readWorkspaceInstancesSnapshot()).toEqual({
      ok: false,
      error: "invalid",
    });

    localStorage.setItem(
      WORKSPACE_INSTANCES_STORAGE_KEY,
      JSON.stringify({ version: 4, windows: [null], instances: [] }),
    );
    expect(readWorkspaceInstancesSnapshot()).toEqual({
      ok: false,
      error: "invalid",
    });
  });

  it("reports unavailable reads without deleting the stored payload", () => {
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      getItem: () => {
        throw new Error("storage blocked");
      },
    });

    expect(readWorkspaceInstancesSnapshot()).toEqual({
      ok: false,
      error: "unavailable",
    });
  });

  it("clears only the v5 workspace instances snapshot", () => {
    localStorage.setItem(WORKSPACE_INSTANCES_STORAGE_KEY, JSON.stringify(makeSnapshot()));
    localStorage.setItem("vmark-workspace:main", "legacy");

    clearWorkspaceInstancesSnapshot();

    expect(localStorage.getItem(WORKSPACE_INSTANCES_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem("vmark-workspace:main")).toBe("legacy");
  });

  it("reports quota write failures without throwing", () => {
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      setItem: () => {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      },
    });

    expect(writeWorkspaceInstancesSnapshot(makeSnapshot())).toEqual({
      ok: false,
      error: "quota",
    });
  });

  it("reports unavailable write failures without throwing", () => {
    vi.stubGlobal("localStorage", {
      ...createMemoryStorage(),
      setItem: () => {
        throw new Error("storage blocked");
      },
    });

    expect(writeWorkspaceInstancesSnapshot(makeSnapshot())).toEqual({
      ok: false,
      error: "unavailable",
    });
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, String(value));
    },
  };
}
