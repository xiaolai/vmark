// @vitest-environment node
// WI-19 — the two workflow flags are independent, and the yaml-surface
// fallback answers to either of them.
//
// Real settings store throughout (WI-18 mock-boundary policy): these functions
// exist only to read it, so a faked store would test the fake.

import { describe, it, expect, afterEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  isWorkflowViewerEnabled,
  isWorkflowEngineEnabled,
  isWorkflowYamlSurfaceEnabled,
} from "./workflowFeatureFlag";

const initial = useSettingsStore.getState().advanced;

function setFlags(patch: { workflowViewer?: boolean; workflowEngine?: boolean }) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("workflow feature flags", () => {
  it("both default to off", () => {
    // The dark-feature verdict rests on this: neither the GHA viewer extras nor
    // the execution engine may switch themselves on.
    expect(useSettingsStore.getState().advanced.workflowViewer).toBe(false);
    expect(useSettingsStore.getState().advanced.workflowEngine).toBe(false);
    expect(isWorkflowViewerEnabled()).toBe(false);
    expect(isWorkflowEngineEnabled()).toBe(false);
  });

  it.each([
    { viewer: false, engine: false },
    { viewer: true, engine: false },
    { viewer: false, engine: true },
    { viewer: true, engine: true },
  ])(
    "reads each flag independently (viewer=$viewer engine=$engine)",
    ({ viewer, engine }) => {
      setFlags({ workflowViewer: viewer, workflowEngine: engine });
      expect(isWorkflowViewerEnabled()).toBe(viewer);
      expect(isWorkflowEngineEnabled()).toBe(engine);
    },
  );

  it("the viewer flag does not switch the engine on — the split's whole point", () => {
    setFlags({ workflowViewer: true, workflowEngine: false });
    expect(isWorkflowViewerEnabled()).toBe(true);
    expect(isWorkflowEngineEnabled()).toBe(false);
  });

  describe("isWorkflowYamlSurfaceEnabled — the file-explorer fallback", () => {
    // Both features make a standalone `.yml` a file VMark should open itself
    // rather than hand to the OS, so the pre-registry-bootstrap fallback in the
    // explorer answers to either. Gating it on one flag alone would hide
    // workflow files from a user who enabled only the other feature.
    it.each([
      { viewer: false, engine: false, expected: false },
      { viewer: true, engine: false, expected: true },
      { viewer: false, engine: true, expected: true },
      { viewer: true, engine: true, expected: true },
    ])("viewer=$viewer engine=$engine → $expected", ({ viewer, engine, expected }) => {
      setFlags({ workflowViewer: viewer, workflowEngine: engine });
      expect(isWorkflowYamlSurfaceEnabled()).toBe(expected);
    });
  });

  it("treats a missing flag as off rather than throwing", () => {
    // Hydration can hand `advanced` back without a key a newer build added.
    useSettingsStore.setState({
      advanced: { ...useSettingsStore.getState().advanced, workflowViewer: undefined as unknown as boolean },
    });
    expect(isWorkflowViewerEnabled()).toBe(false);
  });
});
