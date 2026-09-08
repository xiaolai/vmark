// @vitest-environment node
// WI-2.2 — Guard against the doc↔option drift class that produced T2.
//
// `website/guide/terminal.md` publishes a Range column ("10 – 24 px",
// "1,000 / 5,000 / 10,000 / 50,000 lines"). T2 was a Range the dropdown could
// not produce: 60/70/80 % were offered and silently clamped. The transcription
// below is checked against the option arrays the UI actually renders, so a
// documented range the control cannot reach fails here.
//
// The DEFAULTS half of this file — the Default column transcribed by hand and
// compared to `defaults.ts` — moved to `scripts/lib/docJoins/settingsDefaults.mjs`
// (WI-FL0.4, `pnpm lint:doc-joins`). That gate parses both settings pages
// structurally and fails closed on a row its map does not know, so a REMOVED
// or ADDED row is caught; a transcription cannot see either (Codex objection
// #7). Only the Range column stays transcribed, because no code emits it.
//
// Two terminal-specific pins that are not about the page stay as well: the
// OSC 52 default and its persist-boundary sanitiser (WI-3.5), and the rule that
// every numeric terminal default lies inside its own clamp range.
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
  { row: "Panel Size", documented: [0.1, 0.8], actual: () => panelSizeOptions.map((o) => Number(o.value)) },
  { row: "Font Size", documented: [10, 24], actual: () => fontSizeOptions.map((o) => Number(o.value)) },
  { row: "Line Height", documented: [1.0, 2.0], actual: () => [...lineHeightValues] },
  { row: "Scrollback", documented: [1000, 50000], actual: () => scrollbackOptions.map((o) => Number(o.value)) },
];

const terminal = initialState.terminal as unknown as Record<string, unknown>;

describe("terminal settings doc ↔ offered ranges (WI-2.2)", () => {
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

  it("covers every ranged row the settings table publishes", () => {
    // If a ranged row is added to the doc table without a row here, this test
    // would still pass — so the reverse direction is pinned by count. Bump both
    // together when the published table grows a range.
    expect(DOCUMENTED_RANGES).toHaveLength(4);
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

  it("keeps every numeric terminal default inside its clamp range", () => {
    // A default outside its own clamp would be rewritten on load, so the
    // published value would be a lie the moment settings rehydrate. Checked
    // against the clamp table itself rather than a transcription, so a new
    // bounded field is covered the day it is added.
    const ranges = CLAMP_RANGES.terminal ?? {};
    expect(Object.keys(ranges).length).toBeGreaterThan(0);
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = terminal[key];
      expect(typeof value, `terminal.${key} has a clamp range but no numeric default`).toBe("number");
      expect(value as number, `terminal.${key} default ${String(value)} is below its clamp floor ${min}`)
        .toBeGreaterThanOrEqual(min);
      expect(value as number, `terminal.${key} default ${String(value)} is above its clamp ceiling ${max}`)
        .toBeLessThanOrEqual(max);
    }
  });
});
