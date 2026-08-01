/**
 * The host's mapping from settings to the paste plugins' vocabulary.
 *
 * The fallbacks matter: a settings object that predates a field must not make
 * paste behave arbitrarily, and the plugins have no store to fall back to.
 *
 * @coordinates-with services/assembly/pasteOptions.ts
 * @module services/assembly/pasteOptions.test
 */
import { describe, it, expect, vi } from "vitest";

const getState = vi.fn();
vi.mock("@/stores/settingsStore", () => ({
  useSettingsStore: { getState: () => getState() },
}));

import { currentPasteSettings } from "./pasteOptions";

describe("currentPasteSettings", () => {
  it("passes the user's choices through", () => {
    getState.mockReturnValue({ markdown: { pasteMode: "plain", preserveLineBreaks: true } });
    expect(currentPasteSettings()).toEqual({ pasteMode: "plain", preserveLineBreaks: true });
  });

  it("falls back to smart paste when the mode is unset", () => {
    getState.mockReturnValue({ markdown: {} });
    expect(currentPasteSettings()).toEqual({ pasteMode: "smart", preserveLineBreaks: false });
  });

  it("does not treat `false` as unset", () => {
    // `?? ` rather than `||` — a user who turned preserveLineBreaks OFF must
    // not have it silently turned back on by the default.
    getState.mockReturnValue({ markdown: { pasteMode: "rich", preserveLineBreaks: false } });
    expect(currentPasteSettings().preserveLineBreaks).toBe(false);
  });
});
