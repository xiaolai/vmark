// WI-FL5.7 — the developer-section chord. `Ctrl+Option+Cmd+D` inside the
// Settings window toggles `showDevSection`, which is what puts "Advanced" in the
// navigation. The section ships VISIBLE (defaults.ts `showDevSection: true` —
// Advanced hosts the off switch for the default-on embedded browser), so the
// first press HIDES it. The handler is a window keydown listener with an IME
// guard, and hiding Advanced while it is the section on screen switches the
// page to Appearance during render.
//
// The in-file comment in Settings.tsx still says "Cmd+Shift+D"; that chord is
// asserted here NOT to toggle, so the stale comment cannot become the spec.
//
// Renders the real page against the real store and the global Tauri mocks.
// Only the active panel mounts, so each test starts on `?section=editor`, a
// pane with no mount-time I/O.
//
// Feature ledger, Area 13 "Dev-section reveal chord" (id dev-section-chord).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsPage } from "./Settings";
import { useSettingsStore } from "@/stores/settingsStore";

const CHORD = { key: "d", ctrlKey: true, altKey: true, metaKey: true };
const store = () => useSettingsStore.getState();

function startOn(section: string): void {
  window.history.replaceState(null, "", `/?section=${section}`);
}
const advancedNav = () => screen.queryByRole("button", { name: "Advanced" });
const activeNavLabel = () =>
  screen.getAllByRole("button").find((b) => b.dataset.active === "true")?.textContent;

beforeEach(() => {
  store().resetSettings();
  startOn("editor");
});
afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("SettingsPage — the dev-section chord", () => {
  it("lists Advanced by default: showDevSection ships true", () => {
    render(<SettingsPage />);
    expect(store().showDevSection).toBe(true);
    expect(advancedNav()).not.toBeNull();
  });

  it("hides Advanced on the first press and brings it back on the second", () => {
    render(<SettingsPage />);

    fireEvent.keyDown(window, CHORD);
    expect(store().showDevSection).toBe(false);
    expect(advancedNav()).toBeNull();

    fireEvent.keyDown(window, CHORD);
    expect(store().showDevSection).toBe(true);
    expect(advancedNav()).not.toBeNull();
  });

  it("matches the key case-insensitively, so Shift does not break the chord", () => {
    render(<SettingsPage />);
    fireEvent.keyDown(window, { ...CHORD, key: "D", shiftKey: true });
    expect(store().showDevSection).toBe(false);
  });

  it("claims the chord (preventDefault) and leaves every other key alone", () => {
    render(<SettingsPage />);
    // fireEvent returns false when a listener called preventDefault.
    expect(fireEvent.keyDown(window, CHORD)).toBe(false);
    expect(fireEvent.keyDown(window, { key: "d", metaKey: true })).toBe(true);
  });

  it.each([
    ["Cmd+D", { key: "d", metaKey: true }],
    ["Cmd+Shift+D — the chord the stale in-file comment names", { key: "d", metaKey: true, shiftKey: true }],
    ["Ctrl+Option+D without Cmd", { key: "d", ctrlKey: true, altKey: true }],
    ["Ctrl+Cmd+D without Option", { key: "d", ctrlKey: true, metaKey: true }],
    ["Option+Cmd+D without Ctrl", { key: "d", altKey: true, metaKey: true }],
    ["the full modifier set on another key", { ...CHORD, key: "e" }],
  ])("ignores %s", (_label, init) => {
    render(<SettingsPage />);
    fireEvent.keyDown(window, init);
    expect(store().showDevSection).toBe(true);
    expect(advancedNav()).not.toBeNull();
  });

  it("ignores an IME-generated keydown even with every modifier down", () => {
    render(<SettingsPage />);
    fireEvent.keyDown(window, { ...CHORD, isComposing: true });
    expect(store().showDevSection).toBe(true);
    fireEvent.keyDown(window, { ...CHORD, keyCode: 229 });
    expect(store().showDevSection).toBe(true);
  });

  it("switches to Appearance when the chord hides the Advanced section being viewed", async () => {
    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("button", { name: "Advanced" }));
    expect(activeNavLabel()).toBe("Advanced");

    fireEvent.keyDown(window, CHORD);

    expect(advancedNav()).toBeNull();
    expect(activeNavLabel()).toBe("Appearance");
  });

  it("stops listening once the page unmounts", () => {
    const { unmount } = render(<SettingsPage />);
    unmount();

    fireEvent.keyDown(window, CHORD);
    expect(store().showDevSection).toBe(true);
  });
});

describe("SettingsPage — a `?section=advanced` deep link honours the flag", () => {
  it("opens on Advanced while the section is visible", () => {
    startOn("advanced");
    render(<SettingsPage />);
    expect(activeNavLabel()).toBe("Advanced");
  });

  it("falls back to Appearance during render while the section is hidden", () => {
    store().toggleDevSection();
    startOn("advanced");
    render(<SettingsPage />);
    expect(advancedNav()).toBeNull();
    expect(activeNavLabel()).toBe("Appearance");
  });
});
