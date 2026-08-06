// WI-19 — the two workflow features are switched independently.
//
// One toggle used to arm both: a user who wanted GitHub Actions authoring aids
// (expression completion, cursor↔canvas sync, `uses:` goto-def — all read-only)
// had to switch on an execution engine that spawns AI providers and writes
// files. These pin that the split reached the UI, not only the store.
//
// Real settings store; RTL queries by accessible role/name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSettingsStore } from "@/stores/settingsStore";
import enSettings from "@/locales/en/settings.json";
import zhCnSettings from "@/locales/zh-CN/settings.json";

const VIEWER_LABEL = /workflow viewer/i;
const ENGINE_LABEL = /workflow engine/i;
// A viewer-owned dependent: how the structured GHA editor writes YAML back.
const YAML_FORMATTING_LABEL = /preserve yaml formatting/i;

const initial = useSettingsStore.getState().advanced;

function setAdvanced(patch: Record<string, unknown>) {
  useSettingsStore.setState({
    advanced: { ...useSettingsStore.getState().advanced, ...patch },
  });
}

beforeEach(() => {
  // The experimental group only renders under developer mode.
  setAdvanced({ developerMode: true, workflowViewer: false, workflowEngine: false });
});

afterEach(() => {
  useSettingsStore.setState({ advanced: initial });
});

describe("AdvancedSettings — workflow viewer and engine are separate switches", () => {
  it("offers both toggles", () => {
    render(<AdvancedSettings />);
    expect(screen.getByRole("switch", { name: VIEWER_LABEL })).toBeTruthy();
    expect(screen.getByRole("switch", { name: ENGINE_LABEL })).toBeTruthy();
  });

  it("turning the viewer on does NOT arm the engine", async () => {
    const user = userEvent.setup();
    render(<AdvancedSettings />);
    await user.click(screen.getByRole("switch", { name: VIEWER_LABEL }));

    expect(useSettingsStore.getState().advanced.workflowViewer).toBe(true);
    expect(useSettingsStore.getState().advanced.workflowEngine).toBe(false);
  });

  it("turning the engine on does NOT arm the viewer", async () => {
    const user = userEvent.setup();
    render(<AdvancedSettings />);
    await user.click(screen.getByRole("switch", { name: ENGINE_LABEL }));

    expect(useSettingsStore.getState().advanced.workflowEngine).toBe(true);
    expect(useSettingsStore.getState().advanced.workflowViewer).toBe(false);
  });

  it("keeps the GHA editor's YAML-formatting setting hidden when only the ENGINE is on", () => {
    // It governs how the structured GitHub Actions editor writes YAML back — a
    // viewer concern. It used to hang off the engine flag, which is what made
    // it unreachable for a viewer-only user.
    setAdvanced({ workflowViewer: false, workflowEngine: true });
    render(<AdvancedSettings />);
    expect(screen.queryByRole("switch", { name: YAML_FORMATTING_LABEL })).toBeNull();
  });

  it("reveals the GHA editor's YAML-formatting setting with the VIEWER alone", () => {
    setAdvanced({ workflowViewer: true, workflowEngine: false });
    render(<AdvancedSettings />);
    expect(screen.getByRole("switch", { name: YAML_FORMATTING_LABEL })).toBeTruthy();
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

  it("hides both toggles when developer mode is off", () => {
    setAdvanced({ developerMode: false });
    render(<AdvancedSettings />);
    expect(screen.queryByRole("switch", { name: VIEWER_LABEL })).toBeNull();
    expect(screen.queryByRole("switch", { name: ENGINE_LABEL })).toBeNull();
  });
});
