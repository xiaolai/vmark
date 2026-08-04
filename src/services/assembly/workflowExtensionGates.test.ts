// WI-19 — the source editor's workflow extension families are gated
// SEPARATELY: viewer aids vs execution engine.
//
// Before the split, `isWorkflowEnabled()` decided all four at once, so turning
// on GitHub Actions expression completion also armed the bespoke preview plugin
// that feeds the Run button. This is the decision the composition consumes, so
// it is asserted directly rather than through a fully-mocked CodeMirror tree.
//
// Real settings store (WI-18 mock-boundary policy).

import { describe, it, expect, afterEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { workflowExtensionGates } from "./workflowExtensionGates";

const initial = useSettingsStore.getState().advanced;

function setFlags(patch: { workflowViewer?: boolean; workflowEngine?: boolean }) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("workflowExtensionGates", () => {
  it("gates everything off for a non-YAML file, whatever the flags say", () => {
    setFlags({ workflowViewer: true, workflowEngine: true });
    const gates = workflowExtensionGates("/w/README.md");
    expect(gates).toEqual({ yaml: false, viewer: false, engine: false });
  });

  it("reports YAML independently of the flags — highlighting and parse-lint are unconditional", () => {
    // MED-2: every YAML file gets lang-yaml + the parse-error gutter. Only the
    // workflow families are flag-gated.
    setFlags({ workflowViewer: false, workflowEngine: false });
    expect(workflowExtensionGates("/w/.github/workflows/ci.yml").yaml).toBe(true);
    expect(workflowExtensionGates("/w/docker-compose.yaml").yaml).toBe(true);
  });

  it("viewer on, engine off → authoring aids only, no execution plumbing", () => {
    setFlags({ workflowViewer: true, workflowEngine: false });
    const gates = workflowExtensionGates("/w/.github/workflows/ci.yml");
    expect(gates).toEqual({ yaml: true, viewer: true, engine: false });
  });

  it("engine on, viewer off → execution plumbing only", () => {
    setFlags({ workflowViewer: false, workflowEngine: true });
    const gates = workflowExtensionGates("/w/pipeline.yml");
    expect(gates).toEqual({ yaml: true, viewer: false, engine: true });
  });

  it("both on → both", () => {
    setFlags({ workflowViewer: true, workflowEngine: true });
    const gates = workflowExtensionGates("/w/pipeline.yml");
    expect(gates).toEqual({ yaml: true, viewer: true, engine: true });
  });

  it("handles a null path (untitled buffer) without throwing", () => {
    setFlags({ workflowViewer: true, workflowEngine: true });
    expect(workflowExtensionGates(null)).toEqual({
      yaml: false,
      viewer: false,
      engine: false,
    });
    expect(workflowExtensionGates(undefined)).toEqual({
      yaml: false,
      viewer: false,
      engine: false,
    });
  });

  it("detects the extension from a Windows path", () => {
    // `filePath.split(/[\\/]/)` — a "/"-only split leaves "C:\…\ci.yml" whole
    // and every workflow family silently switches off on Windows.
    setFlags({ workflowViewer: true, workflowEngine: true });
    expect(workflowExtensionGates("C:\\repo\\.github\\workflows\\ci.yml")).toEqual({
      yaml: true,
      viewer: true,
      engine: true,
    });
  });

  it("is case-insensitive about the extension", () => {
    setFlags({ workflowViewer: true, workflowEngine: false });
    expect(workflowExtensionGates("/w/CI.YML").viewer).toBe(true);
  });
});
