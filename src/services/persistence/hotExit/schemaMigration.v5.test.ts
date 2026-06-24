import { describe, expect, it } from "vitest";
import { migrateSession, SCHEMA_VERSION } from "./schemaMigration";
import type { SessionData, TabState } from "./types";

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

function v4Session(): SessionData {
  return {
    version: 4,
    timestamp: 1_760_000_000,
    vmark_version: "0.8.0",
    workspace: {
      root_path: "/repo",
      is_workspace_mode: true,
      show_hidden_files: false,
    },
    windows: [
      {
        window_label: "main",
        is_main_window: true,
        active_tab_id: "tab-loose",
        tabs: [
          tab("tab-workspace", "/repo/a.md"),
          tab("tab-loose", "/outside/b.md"),
          tab("tab-untitled", null),
        ],
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
        workspace_instance_ids: [],
        active_workspace_instance_id: null,
        workspace_instances: [],
      },
    ],
  };
}

describe("Migration v4 -> v5 workspace context ownership", () => {
  it("bumps v4 sessions to the current schema", () => {
    expect(migrateSession(v4Session()).version).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBe(5);
  });

  it("synthesizes workspace and loose contexts from legacy tabs", () => {
    const migrated = migrateSession(v4Session());
    const window = migrated.windows[0];

    expect(window.workspace_instances).toMatchObject([
      {
        kind: "workspace",
        rootPath: "/repo",
        tabIds: ["tab-workspace"],
      },
      {
        kind: "loose",
        rootPath: null,
        tabIds: ["tab-loose", "tab-untitled"],
      },
    ]);
    expect(window.active_workspace_instance_id).toBe(
      window.workspace_instances?.[1]?.workspaceInstanceId,
    );
  });

  it("synthesizes contexts when legacy windows omit the serialized array", () => {
    const session = v4Session();
    session.windows[0].workspace_instances = undefined;
    session.windows[0].workspace_instance_ids = undefined;

    const window = migrateSession(session).windows[0];

    expect(window.workspace_instance_ids).toEqual([
      "wsi-legacy-main-workspace",
      "wsi-legacy-main-loose",
    ]);
    expect(window.workspace_instances?.map((instance) => instance.kind))
      .toEqual(["workspace", "loose"]);
  });

  it("normalizes serialized legacy contexts without trusting stale ownership fields", () => {
    const session = v4Session();
    session.windows[0].active_tab_id = "tab-a";
    session.windows[0].workspace_instance_ids = ["loose", "missing"];
    session.windows[0].active_workspace_instance_id = "missing";
    session.windows[0].workspace_instances = [
      {
        workspaceInstanceId: "workspace",
        rootId: "path:macos:/repo",
        rootPath: "/repo",
        displayName: "repo",
        ownerWindowLabel: "old-owner",
        createdFrom: "open",
        activeTabId: "tab-a",
        tabIds: ["tab-a", "tab-a", 42 as unknown as string],
        closedTabIds: "not-array" as unknown as string[],
      },
      {
        workspaceInstanceId: "loose",
        kind: "loose",
        rootId: "path:macos:/stale",
        rootPath: "/stale",
        displayName: "stale",
        ownerWindowLabel: "old-owner",
        createdFrom: "open",
        activeTabId: null,
        tabIds: ["tab-b"],
        closedTabIds: ["closed", "closed", 42 as unknown as string],
        unavailableRoot: true,
      },
      {
        workspaceInstanceId: "placeholder",
        rootId: null,
        rootPath: null,
        displayName: "Untitled",
        ownerWindowLabel: "old-owner",
        createdFrom: "placeholder",
        activeTabId: null,
        tabIds: [],
        closedTabIds: [],
      },
    ];

    const window = migrateSession(session).windows[0];

    expect(window.workspace_instance_ids).toEqual(["loose", "workspace", "placeholder"]);
    expect(window.active_workspace_instance_id).toBe("workspace");
    expect(window.workspace_instances).toMatchObject([
      {
        workspaceInstanceId: "workspace",
        kind: "workspace",
        ownerWindowLabel: "main",
        tabIds: ["tab-a"],
        closedTabIds: [],
      },
      {
        workspaceInstanceId: "loose",
        kind: "loose",
        rootId: null,
        rootPath: null,
        displayName: "Loose Files",
        ownerWindowLabel: "main",
        closedTabIds: ["closed"],
        unavailableRoot: true,
      },
      {
        workspaceInstanceId: "placeholder",
        kind: "placeholder",
        rootPath: null,
      },
    ]);
  });

  it("falls back to the first non-placeholder context when no active tab maps", () => {
    const session = v4Session();
    session.windows[0].active_tab_id = "missing";
    session.windows[0].active_workspace_instance_id = null;
    session.windows[0].workspace_instance_ids = ["placeholder", "loose"];
    session.windows[0].workspace_instances = [
      {
        workspaceInstanceId: "placeholder",
        rootId: null,
        rootPath: null,
        displayName: "Untitled",
        ownerWindowLabel: "old-owner",
        createdFrom: "placeholder",
        activeTabId: null,
        tabIds: [],
        closedTabIds: [],
      },
      {
        workspaceInstanceId: "loose",
        rootId: null,
        rootPath: null,
        displayName: "Loose Files",
        ownerWindowLabel: "old-owner",
        createdFrom: "open",
        activeTabId: null,
        tabIds: ["tab-loose"],
        closedTabIds: [],
      },
    ];

    expect(migrateSession(session).windows[0].active_workspace_instance_id)
      .toBe("loose");
  });

  it("preserves legacy workspace tabs even when the root identity cannot be created", () => {
    const session = v4Session();
    session.workspace = {
      root_path: "   ",
      is_workspace_mode: true,
      show_hidden_files: false,
    };
    session.windows[0].active_tab_id = "space-path";
    session.windows[0].tabs = [tab("space-path", "   /note.md")];

    const instance = migrateSession(session).windows[0].workspace_instances?.[0];

    expect(instance).toMatchObject({
      kind: "workspace",
      rootId: "path:macos:   ",
      displayName: "   ",
      tabIds: ["space-path"],
      activeTabId: "space-path",
    });
  });
});
