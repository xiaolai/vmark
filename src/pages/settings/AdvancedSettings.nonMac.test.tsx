// The browser settings live in the macOS group, so this pins the OTHER side of that
// branch: on Windows/Linux they must not render at all.
//
// That is a deliberate behaviour change. The `enabled` toggle previously sat in the
// (platform-agnostic) developer-tools group, so a Windows user with devtools on
// could switch on a feature whose native surface is an explicit
// UNSUPPORTED_PLATFORM stub — enabling nothing, while the AI posture controls beside
// it implied otherwise. Grouping all three under `isMac` removes that.
//
// Asserted rather than assumed: without this, the non-Mac path had no coverage and
// the regression would be invisible.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AdvancedSettings } from "./AdvancedSettings";
import { useSettingsStore } from "@/stores/settingsStore";

vi.mock("@/utils/shortcutMatch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/shortcutMatch")>()),
  isMacPlatform: () => false,
}));

describe("AdvancedSettings — browser settings are macOS-only", () => {
  beforeEach(() => {
    useSettingsStore.setState({
      browser: { ...useSettingsStore.getState().browser, enabled: true },
      advanced: { ...useSettingsStore.getState().advanced, devTools: true },
    });
  });

  it("hides the embedded-browser toggle off macOS", () => {
    render(<AdvancedSettings />);
    expect(screen.queryByText(/embedded browser/i)).toBeNull();
  });

  it("hides the dependent AI settings off macOS even when enabled is true", () => {
    // `enabled` is true in the store above — the platform gate, not the feature
    // gate, is what must keep these hidden.
    render(<AdvancedSettings />);
    expect(screen.queryAllByText(/session/i).length).toBe(0);
  });

  it("still renders the rest of the Advanced page", () => {
    // The gate must hide the browser group only — not take the page with it. The
    // workflow-engine row is in the developer group, which is NOT platform-gated,
    // so it is the right witness that the page itself still rendered.
    render(<AdvancedSettings />);
    expect(screen.queryAllByText(/workflow/i).length).toBeGreaterThan(0);
  });
});
