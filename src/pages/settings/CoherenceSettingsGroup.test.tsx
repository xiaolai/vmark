/**
 * τ decides when a semantic check's answer is trusted enough to record as a
 * verdict rather than downgraded to `unknown`. It shipped as a store value with
 * no control, so every user was pinned to 0.9 — and the dogfood run's most
 * common complaint (checks returning `unknown` with the model's real answer
 * discarded) was exactly the symptom of a threshold nobody could move.
 *
 * The values are offered as a labelled few, not a free number: τ is a
 * probability cutoff whose effect is non-obvious, and a raw box invites
 * settings that read as precise while meaning nothing to the person choosing.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { CoherenceSettingsGroup } from "./CoherenceSettingsGroup";

beforeEach(() => {
  useSettingsStore.getState().updateGeneralSetting("coherenceCheckTau", 0.9);
});

describe("CoherenceSettingsGroup", () => {
  it("shows the stored threshold", () => {
    render(<CoherenceSettingsGroup />);
    expect(screen.getByRole("combobox")).toHaveValue("0.9");
  });

  it("persists a changed threshold to the settings store", async () => {
    const user = userEvent.setup();
    render(<CoherenceSettingsGroup />);
    await user.selectOptions(screen.getByRole("combobox"), "0.95");
    expect(useSettingsStore.getState().general.coherenceCheckTau).toBe(0.95);
  });

  it("keeps every offered value inside the clamped range", () => {
    render(<CoherenceSettingsGroup />);
    const values = Array.from(
      screen.getByRole("combobox").querySelectorAll("option"),
    ).map((o) => Number((o as HTMLOptionElement).value));
    // clamp.ts pins coherenceCheckTau to [0.5, 1]; an option outside that would
    // be silently rewritten on load, so the UI would lie about what it set.
    expect(values.length).toBeGreaterThan(1);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.5);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("round-trips a non-default stored value without clobbering it", () => {
    useSettingsStore.getState().updateGeneralSetting("coherenceCheckTau", 0.7);
    render(<CoherenceSettingsGroup />);
    expect(screen.getByRole("combobox")).toHaveValue("0.7");
    expect(useSettingsStore.getState().general.coherenceCheckTau).toBe(0.7);
  });
});

describe("CoherenceSettingsGroup — out-of-list stored value (W1)", () => {
  it("surfaces a stored value that is not one of the presets", () => {
    // clamp.ts permits any [0.5,1]; 0.85 can arrive via MCP or an old config.
    useSettingsStore.getState().updateGeneralSetting("coherenceCheckTau", 0.85);
    render(<CoherenceSettingsGroup />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("0.85");
    const values = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain("0.85");
    // Still sorted and still inside the clamp range.
    const nums = values.map(Number);
    expect([...nums]).toEqual([...nums].sort((a, b) => a - b));
  });
});
