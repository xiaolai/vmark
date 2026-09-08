// WI-19 — the workflow execution engine is its own switch.
//
// One toggle used to arm both the GitHub Actions authoring aids (read-only) and
// an execution engine that spawns AI providers and writes files. The aids have
// no switch at all now (D6 — see AdvancedSettings.workflowViewer.test.tsx);
// what these pin is the engine's side: a toggle of its own, and a description
// that says what arming it permits.
//
// Real settings store; RTL queries by accessible role/name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import enSettings from "@/locales/en/settings.json";
import zhCnSettings from "@/locales/zh-CN/settings.json";

const ENGINE_LABEL = /workflow engine/i;

const initial = useSettingsStore.getState().advanced;

function setAdvanced(patch: Record<string, unknown>) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

beforeEach(() => {
  // The experimental group only renders under developer mode.
  setAdvanced({ developerMode: true, workflowEngine: false });
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("AdvancedSettings — the workflow engine switch", () => {
  it("offers the engine toggle under developer mode", () => {
    render(<AdvancedSettings />);
    expect(screen.getByRole("switch", { name: ENGINE_LABEL })).toBeTruthy();
  });

  it("turning the engine on arms only the engine", async () => {
    const user = userEvent.setup();
    setAdvanced({ workflowEditorPreserveYamlFormatting: true });
    render(<AdvancedSettings />);
    await user.click(screen.getByRole("switch", { name: ENGINE_LABEL }));

    expect(useSettingsStore.getState().advanced.workflowEngine).toBe(true);
    // The viewer's YAML-formatting preference is untouched by the engine.
    expect(useSettingsStore.getState().advanced.workflowEditorPreserveYamlFormatting).toBe(true);
  });

  // Audit 20260804-F1: the engine description used to read "Enable YAML
  // workflow files with React Flow visualization (experimental)" — a viewer's
  // sentence on an execution switch. Nothing in the UI told the user that
  // flipping it lets a YAML file spawn AI provider processes and write to
  // their workspace. The disclosure is the whole point of the string, so it
  // is asserted rather than left to review.
  describe("the engine description discloses what arming it permits", () => {
    it("names process spawning, file writes and snapshots in the rendered UI", () => {
      render(<AdvancedSettings />);
      const engine = screen.getByRole("switch", { name: ENGINE_LABEL });
      const row = engine.closest("[data-setting-row]");
      expect(row).not.toBeNull();
      const text = row?.textContent ?? "";

      expect(text).toMatch(/spawn/i);
      expect(text).toMatch(/AI provider/i);
      expect(text).toMatch(/overwrite files/i);
      expect(text).toMatch(/snapshot/i);
    });

    it("does not describe the engine as a visualization feature", () => {
      render(<AdvancedSettings />);
      const row = screen
        .getByRole("switch", { name: ENGINE_LABEL })
        .closest("[data-setting-row]");
      expect(row?.textContent ?? "").not.toMatch(/React Flow visualization/i);
    });

    // Per-locale spot check: the disclosure has to exist in every bundle, not
    // only the one the jsdom i18n mock serves. EN + one CJK locale.
    it.each([
      ["en", enSettings as Record<string, string>],
      ["zh-CN", zhCnSettings as Record<string, string>],
    ])("%s carries a translated warning, not the old viewer sentence", (_locale, bundle) => {
      const description = bundle["advanced.workflowEngine.description"];
      expect(description).toBeTruthy();
      expect(description).not.toMatch(/React Flow/);
      // Long enough to actually say something — the old string was one clause.
      expect(description.length).toBeGreaterThan(60);
    });

    it("zh-CN discloses execution, file writes and snapshots", () => {
      const description = (zhCnSettings as Record<string, string>)[
        "advanced.workflowEngine.description"
      ];
      expect(description).toContain("执行");
      expect(description).toContain("AI");
      expect(description).toContain("覆盖");
      expect(description).toContain("快照");
    });
  });

  it("hides the engine toggle when developer mode is off", () => {
    setAdvanced({ developerMode: false });
    render(<AdvancedSettings />);
    expect(screen.queryByRole("switch", { name: ENGINE_LABEL })).toBeNull();
  });
});
