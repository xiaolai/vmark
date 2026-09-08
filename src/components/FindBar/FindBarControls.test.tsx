// Audit R2 (#597): `markdown.enableRegexSearch` hid the regex toggle without
// clearing the mode, so a bar left in regex mode kept matching patterns with
// no control on screen to turn it off. Real stores, per the mock-boundary
// policy — the setting is flipped with setState.
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FindBarNavigation,
  FindBarReplaceActions,
  FindBarToggles,
} from "./FindBarControls";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

function setRegexSetting(enabled: boolean): void {
  useSettingsStore.setState((s) => ({
    markdown: { ...s.markdown, enableRegexSearch: enabled },
  }));
}

beforeEach(() => {
  setRegexSetting(true);
  if (useUIStore.getState().search.useRegex) useUIStore.getState().searchToggleRegex();
});

describe("FindBarToggles — the regex setting owns the regex MODE (#597)", () => {
  it("shows the toggle and leaves the mode alone while the setting is on", () => {
    useUIStore.getState().searchToggleRegex();
    render(<FindBarToggles />);
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(useUIStore.getState().search.useRegex).toBe(true);
  });

  it("clears an active regex mode when the setting is off", () => {
    useUIStore.getState().searchToggleRegex();
    expect(useUIStore.getState().search.useRegex).toBe(true);

    setRegexSetting(false);
    render(<FindBarToggles />);

    expect(useUIStore.getState().search.useRegex).toBe(false);
    // Case and whole-word remain; only the regex toggle is gone.
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("does not toggle the mode ON when the setting is off and regex is already off", () => {
    setRegexSetting(false);
    render(<FindBarToggles />);
    expect(useUIStore.getState().search.useRegex).toBe(false);
  });
});

// Audit R3 #596 — a `<button>` with no `type` defaults to `submit`. The bar is
// not inside a form today, which is exactly why nothing failed; the assertion
// is here so the day it is reused inside one is not the day this is discovered.
describe("FindBar controls — every button is type=button (#596)", () => {
  it.each([
    ["toggles", () => <FindBarToggles />],
    ["navigation", () => <FindBarNavigation hasMatches matchDisplay="1 of 2" />],
    ["replace actions", () => <FindBarReplaceActions hasMatches />],
  ])("%s", (_name, renderGroup) => {
    render(renderGroup());
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) expect(button).toHaveAttribute("type", "button");
  });
});
