import { describe, expect, it } from "vitest";
import type { HotExitWorkspaceInstanceState, TabState, WindowState } from "./types";
import {
  chooseActiveIdForRestoredInstances,
  orderedValidIds,
  parseWindowInstances,
  synthesizeWindowInstances,
} from "./workspaceInstanceRestoreData";

function tab(id: string, filePath: string | null): TabState {
  return {
    id,
    file_path: filePath,
    title: id,
    is_pinned: false,
    format_id: "markdown",
    editing_enabled: true,
    active_schema_id: null,
    document: {
      content: "content",
      saved_content: "content",
      is_dirty: false,
      is_missing: false,
      is_divergent: false,
      line_ending: "\n",
      cursor_info: null,
      last_modified_timestamp: null,
      is_untitled: filePath === null,
      untitled_number: filePath === null ? 1 : null,
      undo_history: [],
      redo_history: [],
    },
  };
}

function windowState(overrides: Partial<WindowState> = {}): WindowState {
  return {
    window_label: "main",
    is_main_window: true,
    active_tab_id: null,
    tabs: [],
    ui_state: {
      sidebar_visible: true,
      sidebar_width: 260,
      outline_visible: false,
      sidebar_view_mode: "files",
      status_bar_visible: true,
      source_mode_enabled: false,
      focus_mode_enabled: false,
      typewriter_mode_enabled: false,
    },
    geometry: null,
    ...overrides,
  };
}

function instance(
  overrides: Partial<HotExitWorkspaceInstanceState> = {},
): HotExitWorkspaceInstanceState {
  return {
    workspaceInstanceId: "wsi-a",
    kind: "workspace",
    rootId: "path:macos:/repo",
    rootPath: "/repo",
    displayName: "repo",
    ownerWindowLabel: "old",
    createdFrom: "open",
    activeTabId: null,
    tabIds: [],
    closedTabIds: [],
    ...overrides,
  };
}

describe("workspaceInstanceRestoreData", () => {
  it("returns no instances when the persisted field is absent", () => {
    expect(parseWindowInstances("main", windowState())).toEqual([]);
  });

  it("filters corrupt persisted instances and rewrites window-owned fields", () => {
    const valid = instance({ workspaceInstanceId: "valid", unavailableRoot: true });
    const corrupt: unknown[] = [
      null,
      {},
      instance({ workspaceInstanceId: 1 as unknown as string }),
      instance({ kind: "bad-kind" as HotExitWorkspaceInstanceState["kind"] }),
      instance({ rootId: 42 as unknown as string }),
      instance({ rootPath: 42 as unknown as string }),
      instance({ displayName: 42 as unknown as string }),
      instance({ ownerWindowLabel: 42 as unknown as string }),
      instance({ createdFrom: 42 as unknown as string }),
      instance({ activeTabId: 42 as unknown as string }),
      instance({ tabIds: "tab-a" as unknown as string[] }),
      instance({ tabIds: [42 as unknown as string] }),
      instance({ closedTabIds: "tab-a" as unknown as string[] }),
      instance({ closedTabIds: [42 as unknown as string] }),
      instance({ unavailableRoot: "yes" as unknown as boolean }),
    ];

    expect(
      parseWindowInstances(
        "restored",
        windowState({ workspace_instances: [valid, ...corrupt] as HotExitWorkspaceInstanceState[] }),
      ),
    ).toEqual([
      {
        ...valid,
        ownerWindowLabel: "restored",
        createdFrom: "open",
        unavailableRoot: true,
      },
    ]);
  });

  it("infers legacy instance kinds and sanitizes unknown createdFrom values", () => {
    const parsed = parseWindowInstances(
      "main",
      windowState({
        workspace_instances: [
          instance({ workspaceInstanceId: "explicit-loose", kind: "loose", rootPath: null, rootId: null }),
          instance({ workspaceInstanceId: "explicit-placeholder", kind: "placeholder", rootPath: null, rootId: null }),
          instance({ workspaceInstanceId: "legacy-workspace", kind: undefined, createdFrom: "unknown" }),
          instance({
            workspaceInstanceId: "legacy-placeholder",
            kind: undefined,
            rootId: null,
            rootPath: null,
            createdFrom: "placeholder",
          }),
          instance({
            workspaceInstanceId: "legacy-loose",
            kind: undefined,
            rootId: null,
            rootPath: null,
            createdFrom: "open",
          }),
        ],
      }),
    );

    expect(parsed.map((record) => [record.workspaceInstanceId, record.kind, record.createdFrom]))
      .toEqual([
        ["explicit-loose", "loose", "open"],
        ["explicit-placeholder", "placeholder", "open"],
        ["legacy-workspace", "workspace", "restore"],
        ["legacy-placeholder", "placeholder", "placeholder"],
        ["legacy-loose", "loose", "open"],
      ]);
  });

  it("orders valid ids after removing stale ids and appending omissions", () => {
    const records = [
      instance({ workspaceInstanceId: "a" }),
      instance({ workspaceInstanceId: "b" }),
    ];

    expect(orderedValidIds(["missing", "b"], records)).toEqual(["b", "a"]);
    expect(orderedValidIds(undefined, records)).toEqual(["a", "b"]);
  });

  it("chooses active restored ids by raw id, active tab, fallback, then placeholder", () => {
    const workspace = instance({ workspaceInstanceId: "workspace", tabIds: ["tab-a"] });
    const placeholder = instance({
      workspaceInstanceId: "placeholder",
      kind: "placeholder",
      rootId: null,
      rootPath: null,
    });

    expect(
      chooseActiveIdForRestoredInstances(
        windowState({ active_workspace_instance_id: "workspace" }),
        [workspace, placeholder],
        ["workspace", "placeholder"],
      ),
    ).toBe("workspace");
    expect(
      chooseActiveIdForRestoredInstances(
        windowState({ active_workspace_instance_id: "missing", active_tab_id: "tab-a" }),
        [workspace, placeholder],
        ["placeholder", "workspace"],
      ),
    ).toBe("workspace");
    expect(
      chooseActiveIdForRestoredInstances(
        windowState({ active_workspace_instance_id: "missing", active_tab_id: "missing-tab" }),
        [placeholder, workspace],
        ["placeholder", "workspace"],
      ),
    ).toBe("workspace");
    expect(
      chooseActiveIdForRestoredInstances(
        windowState({ active_workspace_instance_id: "missing" }),
        [placeholder],
        ["placeholder"],
      ),
    ).toBe("placeholder");
    expect(chooseActiveIdForRestoredInstances(windowState(), [], [])).toBeNull();
  });

  it("synthesizes workspace and loose records from legacy tabs", () => {
    const synthesized = synthesizeWindowInstances(
      "main",
      windowState({
        active_tab_id: "outside",
        tabs: [
          tab("inside", "/repo/a.md"),
          tab("outside", "/other/b.md"),
          tab("untitled", null),
        ],
      }),
      "/repo",
    );

    expect(synthesized).toMatchObject([
      { kind: "workspace", rootPath: "/repo", tabIds: ["inside"], activeTabId: null },
      { kind: "loose", rootPath: null, tabIds: ["outside", "untitled"], activeTabId: "outside" },
    ]);
  });

  it("handles empty, root-only, and invalid legacy synthesis inputs", () => {
    expect(synthesizeWindowInstances("main", windowState(), "/repo")).toEqual([]);
    expect(
      synthesizeWindowInstances(
        "main",
        windowState({ active_tab_id: "inside", tabs: [tab("inside", "/repo/a.md")] }),
        "/repo",
      ),
    ).toMatchObject([
      { kind: "workspace", tabIds: ["inside"], activeTabId: "inside" },
    ]);
    // Unusable (blank) root: the workspace tab must be PRESERVED with a
    // fallback identity, not dropped. This matches the v5 migration path.
    expect(
      synthesizeWindowInstances(
        "main",
        windowState({ active_tab_id: "space-path", tabs: [tab("space-path", "   /a.md")] }),
        "   ",
      ),
    ).toMatchObject([
      {
        kind: "workspace",
        rootId: "path:macos:   ",
        rootPath: "   ",
        tabIds: ["space-path"],
        activeTabId: "space-path",
      },
    ]);
  });
});
