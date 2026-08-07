// #1224 — the "Show file extensions" switch.
//
// Consumer tests (tree, tab strip, title bar) and the defaults test both read
// `general.showFileExtensions`, so all of them pass while the settings row
// itself is wired to nothing. This covers the row: that it reflects the stored
// value, and that operating it writes back.
//
// Real settings store; RTL queries by accessible role/name.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FilesImagesSettings } from "./FilesImagesSettings";
import { useSettingsStore } from "@/stores/settingsStore";

const LABEL = /show file extensions/i;

const initial = useSettingsStore.getState().general;

function setShowExtensions(value: boolean) {
  useSettingsStore.setState({
    general: { ...useSettingsStore.getState().general, showFileExtensions: value },
  });
}

beforeEach(() => setShowExtensions(true));
afterEach(() => useSettingsStore.setState({ general: initial }));

describe("FilesImagesSettings — show file extensions", () => {
  it("reflects the stored value", () => {
    render(<FilesImagesSettings />);
    expect(screen.getByRole("switch", { name: LABEL })).toBeChecked();

    act(() => setShowExtensions(false));
    expect(screen.getByRole("switch", { name: LABEL })).not.toBeChecked();
  });

  it("writes the change back to the store", async () => {
    const user = userEvent.setup();
    render(<FilesImagesSettings />);

    await user.click(screen.getByRole("switch", { name: LABEL }));
    expect(useSettingsStore.getState().general.showFileExtensions).toBe(false);

    await user.click(screen.getByRole("switch", { name: LABEL }));
    expect(useSettingsStore.getState().general.showFileExtensions).toBe(true);
  });

  // The two rows above it are workspace-scoped and disable themselves without
  // a workspace. This one is global — a tab strip and a title bar exist with
  // no folder open, so the switch has to stay operable.
  it("stays enabled outside workspace mode", () => {
    render(<FilesImagesSettings />);
    expect(screen.getByRole("switch", { name: LABEL })).toBeEnabled();
  });
});
