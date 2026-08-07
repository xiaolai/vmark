// @vitest-environment node
// WI-2.2 — Guard against the doc↔default drift class that produced T9.
//
// `website/guide/terminal.md` documented "Mac Option as Meta … Default: Off"
// while `defaults.ts` had shipped `macOptionIsMeta: true` since #660. Nothing
// noticed, because nothing compares the two. T9 is a CLASS of bug (a default
// drifted away from its published value), not a one-off incident — fixing the
// instance without a guard means doing it again.
//
// Design note: this asserts against the DEFAULTS MODULE, with the published
// table transcribed below, rather than parsing the markdown. Parsing
// `website/*.md` in a unit test is brittle (any table reformat breaks it) and
// couples the app's test run to the website's authoring style. The cost is
// that the transcription must be kept honest by hand — which is exactly the
// edit a doc change already requires, and the failure message names the file
// and row to change.
import { describe, it, expect } from "vitest";
import { initialState } from "@/stores/settingsStore/defaults";
import { CLAMP_RANGES } from "@/stores/settingsStore/clamp";
import { sanitizePersistedSettings } from "@/stores/settingsStore/persistGuards";
import {
  panelSizeOptions,
  fontSizeOptions,
  scrollbackOptions,
  lineHeightValues,
} from "../terminalSettingsHelpers";

/** Where the published values live. Named in every failure message. */
const DOC = "website/guide/terminal.md";

/**
 * The Settings table as published, transcribed. `key` is the settings-store
 * field; `documented` is the value the table's Default column claims.
 */
const DOCUMENTED_DEFAULTS: Array<{ row: string; key: string; documented: unknown }> = [
  { row: "Panel Size", key: "panelRatio", documented: 0.4 },
  { row: "Font Size", key: "fontSize", documented: 13 },
  { row: "Line Height", key: "lineHeight", documented: 1.2 },
  { row: "Copy on Select", key: "copyOnSelect", documented: false },
  { row: "Mac Option as Meta", key: "macOptionIsMeta", documented: true },
  { row: "Shell Integration", key: "shellIntegration", documented: true },
  { row: "Remote Clipboard (OSC 52)", key: "osc52Clipboard", documented: true },
  { row: "Scrollback", key: "scrollback", documented: 5000 },
  { row: "Screen Reader Mode", key: "screenReaderMode", documented: false },
  // Accessibility sub-table.
  { row: "Terminal bell", key: "bellMode", documented: "visual" },
  { row: "Minimum contrast", key: "minimumContrastRatio", documented: 4.5 },
];

/**
 * The Range column, where it is checkable against the option arrays the UI
 * actually renders. A documented range that the dropdown cannot produce is the
 * same defect as a wrong default (that is T2 — 60/70/80 % were offered and
 * silently clamped).
 */
const DOCUMENTED_RANGES: Array<{
  row: string;
  documented: [number, number];
  actual: () => number[];
}> = [
  { row: "Panel Size", documented: [0.1, 0.5], actual: () => panelSizeOptions.map((o) => Number(o.value)) },
  { row: "Font Size", documented: [10, 24], actual: () => fontSizeOptions.map((o) => Number(o.value)) },
  { row: "Line Height", documented: [1.0, 2.0], actual: () => [...lineHeightValues] },
  { row: "Scrollback", documented: [1000, 50000], actual: () => scrollbackOptions.map((o) => Number(o.value)) },
];

const terminal = initialState.terminal as unknown as Record<string, unknown>;

describe("terminal settings doc ↔ defaults (WI-2.2)", () => {
  it.each(DOCUMENTED_DEFAULTS)(
    "$row: the default matches what $key ships",
    ({ row, key, documented }) => {
      expect(
        terminal[key],
        `${DOC} row "${row}" claims ${JSON.stringify(documented)}, but ` +
          `defaults.ts terminal.${key} is ${JSON.stringify(terminal[key])}. ` +
          `Update whichever is wrong — they must agree.`,
      ).toBe(documented);
    },
  );

  it.each(DOCUMENTED_RANGES)(
    "$row: the documented range matches the offered options",
    ({ row, documented, actual }) => {
      const values = actual();
      expect(
        [Math.min(...values), Math.max(...values)],
        `${DOC} row "${row}" documents the range ${documented[0]}–${documented[1]}, ` +
          `but the dropdown offers ${Math.min(...values)}–${Math.max(...values)}.`,
      ).toEqual(documented);
    },
  );

  it("covers every terminal key the settings table publishes", () => {
    // If a row is added to the doc table without a row here, this test would
    // still pass — so the reverse direction is pinned by count. Bump both
    // together when the published table grows.
    expect(DOCUMENTED_DEFAULTS).toHaveLength(11);
    expect(DOCUMENTED_RANGES).toHaveLength(4);
  });

  it("names only keys that exist in the defaults", () => {
    for (const { key } of DOCUMENTED_DEFAULTS) {
      expect(Object.hasOwn(terminal, key), `terminal.${key} no longer exists`).toBe(true);
    }
  });

  it("defaults OSC 52 clipboard writes to on (WI-3.5)", () => {
    // Write access is the useful, low-risk half of OSC 52 (yank in a remote
    // vim reaches the host clipboard). READ is denied unconditionally in
    // setupOsc52 and is NOT what this toggle controls — see that module's
    // tests for the security assertion.
    expect(terminal.osc52Clipboard).toBe(true);
  });

  it("drops a corrupt persisted osc52Clipboard rather than trusting it", () => {
    // The setting is boolean; a persisted string would make `enabled` truthy
    // for "false" and silently re-enable a channel the user turned off.
    const clean = sanitizePersistedSettings(
      { terminal: { osc52Clipboard: "false" } },
      initialState as unknown as Record<string, unknown>,
    );
    expect((clean.terminal as Record<string, unknown>)).not.toHaveProperty(
      "osc52Clipboard",
    );

    const kept = sanitizePersistedSettings(
      { terminal: { osc52Clipboard: false } },
      initialState as unknown as Record<string, unknown>,
    );
    expect((kept.terminal as Record<string, unknown>).osc52Clipboard).toBe(false);
  });

  it("keeps every documented default inside its clamp range", () => {
    // A default outside its own clamp would be rewritten on load, so the
    // documented value would be a lie the moment settings rehydrate.
    const ranges = CLAMP_RANGES.terminal ?? {};
    for (const { row, key, documented } of DOCUMENTED_DEFAULTS) {
      const range = ranges[key];
      if (!range || typeof documented !== "number") continue;
      expect(documented, `${DOC} row "${row}" is outside terminal.${key}'s clamp`).
        toBeGreaterThanOrEqual(range[0]);
      expect(documented).toBeLessThanOrEqual(range[1]);
    }
  });
});
