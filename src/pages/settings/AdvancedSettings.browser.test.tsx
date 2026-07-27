// The three embedded-browser settings are ONE group with ONE gate.
//
// They used to disagree: `aiSession` and `aiAllowLoopback` sat in the macOS group
// in plain sight, while the `enabled` toggle that makes them mean anything was
// behind `devTools`. So a user could configure a feature they had no way to switch
// on — and `website/guide/browser.md` calls it "an early, OPT-IN feature", which a
// developer-only toggle makes untrue. These pin the unified shape so the three
// cannot drift apart again.

import { describe, it, expect, beforeEach, vi } from "vitest";

// The browser settings live in the macOS group — the feature IS macOS-only (every
// other platform's native surface is an explicit UNSUPPORTED_PLATFORM stub), so a
// toggle there would enable nothing. jsdom reports a non-Mac platform, so the group
// would not render and every assertion below would pass vacuously by finding
// nothing. Mocking this is what makes the tests actually exercise the group.
vi.mock("@/utils/shortcutMatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/shortcutMatch")>()),
  isMacPlatform: () => true,
}));
import { render, screen } from "@testing-library/react";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSettingsStore } from "@/stores/settingsStore";

const BROWSER_LABEL = /embedded browser/i;
const SESSION_LABEL = /session/i;

function setBrowser(patch: Record<string, unknown>) {
  useSettingsStore.setState({
    browser: { ...useSettingsStore.getState().browser, ...patch },
  });
}

describe("AdvancedSettings — the browser settings are one coherent group", () => {
  beforeEach(() => {
    setBrowser({ enabled: false, aiSession: "sandbox", aiAllowLoopback: false });
  });

  it("shows the embedded-browser toggle WITHOUT developer mode", () => {
    // The regression this guards: the toggle was inside `{devTools && …}`, so with
    // developer mode off it did not render at all and the menu item it controls
    // stayed permanently dead with no discoverable way to enable it.
    useSettingsStore.setState({
      advanced: { ...useSettingsStore.getState().advanced, devTools: false },
    });
    render(<AdvancedSettings />);
    expect(screen.queryByText(BROWSER_LABEL)).toBeTruthy();
  });

  it("hides the dependent AI settings while the browser is OFF", () => {
    render(<AdvancedSettings />);
    // Configuring AI posture for a feature that is switched off is the conflict
    // this restructure removes.
    const sessionRows = screen.queryAllByText(SESSION_LABEL);
    expect(sessionRows.length).toBe(0);
  });

  it("reveals the dependent AI settings once the browser is ON", () => {
    setBrowser({ enabled: true });
    render(<AdvancedSettings />);
    expect(screen.queryAllByText(SESSION_LABEL).length).toBeGreaterThan(0);
  });

  it("keeps the gate visible when the dependents are hidden", () => {
    // The gate must never hide itself — otherwise turning the feature back on
    // would be impossible from this screen.
    render(<AdvancedSettings />);
    expect(screen.queryByText(BROWSER_LABEL)).toBeTruthy();
  });
});
