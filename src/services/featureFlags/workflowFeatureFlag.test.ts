// @vitest-environment node
// After D6 (WI-FL2.6) one workflow flag remains: the execution engine. The
// GitHub Actions viewer has no switch — the workbench and its source-pane aids
// ship on — so the yaml-surface fallback the file explorer consults before the
// format registry is bootstrapped is unconditional too.
//
// Real settings store throughout (WI-18 mock-boundary policy): these functions
// exist only to read it, so a faked store would test the fake.

import { describe, it, expect, afterEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import * as flags from "./workflowFeatureFlag";
import { isWorkflowEngineEnabled } from "./workflowFeatureFlag";

const initial = useSettingsStore.getState().advanced;

function setEngine(workflowEngine: boolean | undefined) {
  useSettingsStore.setState({
    advanced: {
      ...useSettingsStore.getState().advanced,
      // `undefined` models hydration handing back an `advanced` without a key
      // a newer build added; the store type cannot express that on purpose.
      workflowEngine: workflowEngine as unknown as boolean,
    },
  });
}

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("workflow feature flags", () => {
  it("the engine defaults to off — the dark-feature verdict rests on this", () => {
    expect(useSettingsStore.getState().advanced.workflowEngine).toBe(false);
    expect(isWorkflowEngineEnabled()).toBe(false);
  });

  it("there is no viewer flag any more (D6): no default, no reader", () => {
    expect("workflowViewer" in useSettingsStore.getState().advanced).toBe(false);
    expect("isWorkflowViewerEnabled" in flags).toBe(false);
  });

  it.each([false, true])("reads the engine flag (%s)", (engine) => {
    setEngine(engine);
    expect(isWorkflowEngineEnabled()).toBe(engine);
  });

  it("treats a missing engine flag as off rather than throwing", () => {
    setEngine(undefined);
    expect(isWorkflowEngineEnabled()).toBe(false);
  });

});
