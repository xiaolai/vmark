import { describe, expect, it } from "vitest";
import {
  migrateSession,
  SCHEMA_VERSION,
} from "./schemaMigration";
import type { SessionData } from "./types";

function makeV3Session(): SessionData {
  return {
    version: 3,
    timestamp: 1_760_000_000,
    vmark_version: "0.8.0",
    windows: [
      {
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
      },
    ],
    workspace: null,
  };
}

describe("Migration v3 -> v4 workspace instances", () => {
  it("bumps v3 sessions to the current schema", () => {
    const migrated = migrateSession(makeV3Session());

    expect(SCHEMA_VERSION).toBe(5);
    expect(migrated.version).toBe(5);
  });

  it("adds empty workspace instance containers to legacy windows", () => {
    const migrated = migrateSession(makeV3Session());
    const window = migrated.windows[0];

    expect(window.workspace_instance_ids).toEqual([]);
    expect(window.active_workspace_instance_id).toBeNull();
    expect(window.workspace_instances).toEqual([]);
  });

  it("preserves explicit v4 workspace instance containers on partially migrated payloads", () => {
    const session = makeV3Session();
    session.windows[0].workspace_instance_ids = ["ws-1", "ws-2"];
    session.windows[0].active_workspace_instance_id = "ws-2";
    session.windows[0].workspace_instances = [
      {
        workspaceInstanceId: "ws-1",
        rootId: "path:macos:/tmp/a",
        rootPath: "/tmp/a",
        displayName: "a",
        ownerWindowLabel: "main",
        createdFrom: "open",
        activeTabId: null,
        tabIds: [],
        closedTabIds: [],
      },
    ];

    const migrated = migrateSession(session);

    expect(migrated.windows[0].workspace_instance_ids).toEqual(["ws-1"]);
    expect(migrated.windows[0].active_workspace_instance_id).toBe("ws-1");
    expect(migrated.windows[0].workspace_instances).toHaveLength(1);
    expect(migrated.windows[0].workspace_instances?.[0]).toMatchObject({
      kind: "workspace",
    });
  });
});
