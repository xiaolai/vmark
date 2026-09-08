// @vitest-environment node
// The source editor's workflow extension families, after D6 (WI-FL2.6):
//
//   - `yaml`   is a property of the FILE — every YAML file, no flag;
//   - `viewer` follows `yaml` unconditionally — the GitHub Actions authoring
//              aids ship on, so a markdown-window source editor gets the same
//              extras the split-pane YAML source pane always loaded;
//   - `engine` is the ONLY gated family: the bespoke execution engine's
//              preview parse still waits for `advanced.workflowEngine`.
//
// Before WI-19 one flag decided all four extensions, so enabling expression
// completion also armed the plugin that feeds the Run button. Before D6 the
// viewer family had a flag of its own that nothing else consulted. This is the
// decision the composition consumes, asserted directly rather than through a
// fully-mocked CodeMirror tree.
//
// Real settings store (WI-18 mock-boundary policy).

import { describe, it, expect, afterEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { workflowExtensionGates } from "./workflowExtensionGates";

const initial = useSettingsStore.getState().advanced;

function setEngine(workflowEngine: boolean) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, workflowEngine },
  });
}

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

const OFF = { yaml: false, viewer: false, engine: false };

describe("workflowExtensionGates", () => {
  it.each([false, true])("a non-YAML file gets NO workflow family (engine=%s)", (engine) => {
    setEngine(engine);
    for (const path of ["/w/README.md", "/w/notes.txt", "/w/ci.yml.bak", "/w/data.json"]) {
      expect(workflowExtensionGates(path)).toEqual(OFF);
    }
  });

  it("gives every YAML file the viewer aids with the engine OFF — no flag gates them (D6)", () => {
    setEngine(false);
    expect(workflowExtensionGates("/w/.github/workflows/ci.yml")).toEqual({
      yaml: true,
      viewer: true,
      engine: false,
    });
    expect(workflowExtensionGates("/w/docker-compose.yaml")).toEqual({
      yaml: true,
      viewer: true,
      engine: false,
    });
  });

  it("keeps the engine family behind advanced.workflowEngine — the one gate left", () => {
    setEngine(true);
    expect(workflowExtensionGates("/w/pipeline.yml")).toEqual({
      yaml: true,
      viewer: true,
      engine: true,
    });
  });

  it("viewer equals yaml for every path — it reads no setting at all", () => {
    // Re-gating the viewer on the engine (the pre-WI-19 shape) is the
    // regression this catches: with the engine off, viewer would go false on
    // the YAML paths.
    setEngine(false);
    for (const path of ["/w/a.yml", "/w/b.yaml", "C:\\r\\c.YML", "/w/README.md", null, undefined]) {
      const gates = workflowExtensionGates(path);
      expect(gates.viewer).toBe(gates.yaml);
    }
  });

  it("handles a null or empty path (untitled buffer) without throwing", () => {
    setEngine(true);
    expect(workflowExtensionGates(null)).toEqual(OFF);
    expect(workflowExtensionGates(undefined)).toEqual(OFF);
    expect(workflowExtensionGates("")).toEqual(OFF);
  });

  it("detects the extension from a Windows path", () => {
    // `filePath.split(/[\\/]/)` — a "/"-only split leaves "C:\…\ci.yml" whole
    // and every workflow family silently switches off on Windows.
    setEngine(true);
    expect(workflowExtensionGates("C:\\repo\\.github\\workflows\\ci.yml")).toEqual({
      yaml: true,
      viewer: true,
      engine: true,
    });
  });

  it("is case-insensitive about the extension", () => {
    setEngine(false);
    expect(workflowExtensionGates("/w/CI.YML")).toEqual({ yaml: true, viewer: true, engine: false });
  });
});
