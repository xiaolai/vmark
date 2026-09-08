// WI-FL2.6 / WI-FL7.1 (D6) — the workflow viewer has no switch.
//
// The GitHub Actions workbench was always unconditional, the split-pane source
// aids never read the flag, and rule 60 §12 wanted it on by 2026-09-15.
// Removing the flag leaves the viewer's one preference — how the structured
// editor writes YAML back — which the viewer toggle used to REVEAL and which is
// now a plain row under the developer section, where it stays reachable.
//
// Real settings store; RTL queries by accessible role/name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import enSettings from "@/locales/en/settings.json";

const VIEWER_LABEL = /workflow viewer/i;
const ENGINE_LABEL = /workflow engine/i;
const YAML_FORMATTING_LABEL = /preserve yaml formatting/i;

const initial = useSettingsStore.getState().advanced;

function setAdvanced(patch: Partial<typeof initial>) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

beforeEach(() => {
  setAdvanced({ developerMode: true, workflowEngine: false });
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("AdvancedSettings — the workflow viewer flag is gone (D6)", () => {
  it("offers no viewer switch, with developer mode on", () => {
    render(<AdvancedSettings />);
    expect(screen.queryByRole("switch", { name: VIEWER_LABEL })).toBeNull();
    // The engine is still a switch — it is the other feature, not the viewer.
    expect(screen.getByRole("switch", { name: ENGINE_LABEL })).toBeTruthy();
  });

  it("ships no advanced.workflowViewer default and no locale strings for it", () => {
    expect("workflowViewer" in useSettingsStore.getState().advanced).toBe(false);
    // Key parity across the ten locales is lint:i18n's job; the English bundle
    // defines the key set, so its absence here is its absence everywhere.
    const keys = Object.keys(enSettings as Record<string, string>);
    expect(keys.filter((k) => k.includes("workflowViewer"))).toEqual([]);
  });

  describe("the YAML-formatting preference the flag used to hide", () => {
    it("is reachable with the engine OFF — nothing but developer mode reveals it", () => {
      setAdvanced({ workflowEngine: false });
      render(<AdvancedSettings />);
      expect(screen.getByRole("switch", { name: YAML_FORMATTING_LABEL })).toBeTruthy();
    });

    it("is still there with the engine ON — it never hung off the engine", () => {
      setAdvanced({ workflowEngine: true });
      render(<AdvancedSettings />);
      expect(screen.getByRole("switch", { name: YAML_FORMATTING_LABEL })).toBeTruthy();
    });

    it("writes advanced.workflowEditorPreserveYamlFormatting and arms nothing else", async () => {
      const user = userEvent.setup();
      setAdvanced({ workflowEditorPreserveYamlFormatting: true });
      render(<AdvancedSettings />);
      const row = screen.getByRole("switch", { name: YAML_FORMATTING_LABEL });
      expect(row).toBeChecked();

      await user.click(row);

      expect(useSettingsStore.getState().advanced.workflowEditorPreserveYamlFormatting).toBe(false);
      expect(useSettingsStore.getState().advanced.workflowEngine).toBe(false);
    });

    it("lives under the developer section — hidden while developer mode is off", () => {
      setAdvanced({ developerMode: false });
      render(<AdvancedSettings />);
      expect(screen.queryByRole("switch", { name: YAML_FORMATTING_LABEL })).toBeNull();
      expect(screen.queryByRole("switch", { name: ENGINE_LABEL })).toBeNull();
    });
  });
});
