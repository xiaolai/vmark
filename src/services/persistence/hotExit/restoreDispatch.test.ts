// @vitest-environment node
/**
 * Tests for hot-exit restore dispatch (#970).
 *
 * The manual "Test Restore" button previously always invoked the single-window
 * command, silently dropping secondary windows. Both paths now derive the
 * command from this shared helper.
 */

import { describe, it, expect } from "vitest";
import {
  hasSecondaryWindows,
  restoreCommandFor,
  salvageSessionPayload,
  HOT_EXIT_RESTORE,
  HOT_EXIT_RESTORE_MULTI,
} from "./restoreDispatch";
import type { SessionData, WindowState } from "./types";

function win(is_main_window: boolean): WindowState {
  // The dispatch helper only reads is_main_window; keep the fixture minimal.
  return { is_main_window } as unknown as WindowState;
}

function session(windows: WindowState[]): SessionData {
  return { windows } as unknown as SessionData;
}

describe("hasSecondaryWindows", () => {
  it("is false for a single main-only window", () => {
    expect(hasSecondaryWindows(session([win(true)]))).toBe(false);
  });

  it("is true when any non-main window exists", () => {
    expect(hasSecondaryWindows(session([win(true), win(false)]))).toBe(true);
  });

  it("is true even when no window is flagged main", () => {
    expect(hasSecondaryWindows(session([win(false), win(false)]))).toBe(true);
  });

  it("is false for an empty window list", () => {
    expect(hasSecondaryWindows(session([]))).toBe(false);
  });
});

describe("restoreCommandFor", () => {
  it("uses the single-window command for a main-only session", () => {
    expect(restoreCommandFor(session([win(true)]))).toBe(HOT_EXIT_RESTORE);
  });

  it("uses the multi-window command when secondary windows are present", () => {
    expect(restoreCommandFor(session([win(true), win(false)]))).toBe(
      HOT_EXIT_RESTORE_MULTI,
    );
  });
});

// WI-3 — the dispatch module is the validated read boundary: payloads pass
// through salvageSessionPayload before any restore command is chosen.
describe("salvage → dispatch boundary (WI-3)", () => {
  const fullWin = (label: string, is_main_window: boolean) => ({
    window_label: label,
    is_main_window,
    active_tab_id: null,
    tabs: [],
  });

  it("a salvaged multi-window session still routes to the multi-window command", () => {
    const raw = {
      version: 5,
      timestamp: 1754200000,
      vmark_version: "0.9.26",
      windows: [fullWin("main", true), fullWin("secondary-1", false)],
      workspace: null,
    };
    const result = salvageSessionPayload(raw);
    if (result.status !== "ok") throw new Error(`expected ok, got ${result.status}`);
    expect(restoreCommandFor(result.session)).toBe(HOT_EXIT_RESTORE_MULTI);
  });

  it("an unusable envelope never reaches command selection", () => {
    const result = salvageSessionPayload({ version: 5, windows: "junk" });
    expect(result.status).toBe("invalid");
  });
});
