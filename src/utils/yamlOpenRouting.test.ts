// Tauri-MCP smoke follow-up — yamlOpenRouting unit tests.
//
// Why: opening a workflow .yml via Recent Files / Finder / drag-drop
// used to route through WYSIWYG markdown parsing first, which silently
// corrupted YAML indentation. maybeForceSourceForYaml is the single
// pre-initDocument hook that marks the tab as forced-source so the
// WYSIWYG editor never mounts against the YAML document.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useLargeFileSessionStore } from "@/stores/largeFileSessionStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { maybeForceSourceForYaml } from "./yamlOpenRouting";

beforeEach(() => {
  // Reset largeFileSessionStore state.
  useLargeFileSessionStore.setState({ forcedSourceTabs: {} });
  // Workflow flag is per-test — restore in afterEach.
});

afterEach(() => {
  useSettingsStore.getState().updateAdvancedSetting("workflowEngine", false);
});

describe("maybeForceSourceForYaml", () => {
  it("marks the tab as forced-source for a .yml file when workflow engine is on", () => {
    useSettingsStore.getState().updateAdvancedSetting("workflowEngine", true);
    maybeForceSourceForYaml("tab-1", "/repo/.github/workflows/ci.yml");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs["tab-1"]).toBe(true);
  });

  it("marks the tab as forced-source for a .yaml file when workflow engine is on", () => {
    useSettingsStore.getState().updateAdvancedSetting("workflowEngine", true);
    maybeForceSourceForYaml("tab-2", "/some/path/foo.yaml");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs["tab-2"]).toBe(true);
  });

  it("no-ops for .md files even when workflow engine is on", () => {
    useSettingsStore.getState().updateAdvancedSetting("workflowEngine", true);
    maybeForceSourceForYaml("tab-3", "/notes/readme.md");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs["tab-3"]).toBeUndefined();
  });

  it("no-ops for YAML when the workflow engine flag is off", () => {
    // workflowEngine defaults to false.
    maybeForceSourceForYaml("tab-4", "/repo/.github/workflows/ci.yml");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs["tab-4"]).toBeUndefined();
  });

  it("is idempotent — repeat calls keep the flag set", () => {
    useSettingsStore.getState().updateAdvancedSetting("workflowEngine", true);
    maybeForceSourceForYaml("tab-5", "/repo/foo.yml");
    maybeForceSourceForYaml("tab-5", "/repo/foo.yml");
    expect(useLargeFileSessionStore.getState().forcedSourceTabs["tab-5"]).toBe(true);
  });
});
