// @vitest-environment node
// WI-1.2 — Panel Size options must not offer a value the layout silently clamps.
// WI-1.3 — Font Size options must tolerate a zoomed value outside the presets.
import { describe, it, expect } from "vitest";
import {
  panelSizeOptions,
  fontSizeOptions,
  fontSizeOptionsFor,
  withCurrentNumericOption,
  lineHeightChoices,
  lineHeightValues,
  shellLabel,
  snapToOption,
} from "./terminalSettingsHelpers";
import { ratioToPixels } from "@/components/Terminal/useTerminalPosition";
import { TERMINAL_MAX_RATIO, TERMINAL_MIN_HEIGHT } from "@/stores/uiStore";

describe("panelSizeOptions (WI-1.2)", () => {
  it("no option is silently clamped", () => {
    // The layout cap (TERMINAL_MAX_RATIO) is enforced in three independent
    // places. An option above it renders identically to the cap while the
    // dropdown keeps claiming the larger number — a dead control.
    // A representative available dimension large enough that the pixel FLOOR
    // never binds, so any difference is the ceiling clamping.
    const available = 2000;
    for (const opt of panelSizeOptions) {
      const v = Number(opt.value);
      expect(ratioToPixels(v, available, TERMINAL_MIN_HEIGHT)).toBe(
        Math.round(available * v),
      );
    }
  });

  it("offers no value above the enforced cap", () => {
    for (const opt of panelSizeOptions) {
      expect(Number(opt.value)).toBeLessThanOrEqual(TERMINAL_MAX_RATIO);
    }
  });

  it("still offers the cap itself as the largest choice", () => {
    const values = panelSizeOptions.map((o) => Number(o.value));
    expect(Math.max(...values)).toBe(TERMINAL_MAX_RATIO);
  });

  it("labels every option as a whole percentage of its value", () => {
    for (const opt of panelSizeOptions) {
      expect(opt.label).toBe(`${Math.round(Number(opt.value) * 100)}%`);
    }
  });

  it("snapToOption maps a legacy over-cap ratio to the cap", () => {
    // A build before WI-1.2 could persist 0.6/0.7/0.8. The panel was ALWAYS
    // rendering at the cap for those; the dropdown must now say so rather than
    // display a number the layout never honored.
    expect(snapToOption(0.8)).toBe(String(TERMINAL_MAX_RATIO));
    expect(snapToOption(0.7)).toBe(String(TERMINAL_MAX_RATIO));
    expect(snapToOption(0.6)).toBe(String(TERMINAL_MAX_RATIO));
  });

  it("snapToOption still returns an exact preset unchanged", () => {
    expect(snapToOption(0.25)).toBe("0.25");
    expect(snapToOption(0.5)).toBe("0.5");
  });

  it("snapToOption snaps a between-presets ratio to the nearest one", () => {
    expect(snapToOption(0.26)).toBe("0.25");
    expect(snapToOption(0.33)).toBe("0.35");
  });

  it("snapToOption floors a below-range ratio to the smallest option", () => {
    expect(snapToOption(0)).toBe("0.1");
    expect(snapToOption(-1)).toBe("0.1");
  });
});

describe("fontSizeOptionsFor (WI-1.3)", () => {
  it("returns the preset list unchanged for a preset value", () => {
    expect(fontSizeOptionsFor(13)).toEqual(fontSizeOptions);
  });

  it("does not duplicate a preset value", () => {
    const values = fontSizeOptionsFor(14).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("injects a zoomed value that is not in the preset list", () => {
    // Mod+/- steps by 2 from a default of 13, so the very first zoom lands on
    // 15 — absent from the presets. A native <select> with an unmatched value
    // displays its FIRST option ("10px"), and touching the control then writes
    // 10, silently discarding the user's zoom.
    const opts = fontSizeOptionsFor(15);
    expect(opts.map((o) => o.value)).toContain("15");
    expect(opts.find((o) => o.value === "15")?.label).toBe("15px");
  });

  it("keeps the injected value in ascending numeric order", () => {
    const values = fontSizeOptionsFor(15).map((o) => Number(o.value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
  });

  it("renders both clamp edges (8 and 32)", () => {
    // settingsStore clamps terminal.fontSize to [8, 32]; the presets run
    // 10..24, so BOTH edges fall outside and must still render.
    expect(fontSizeOptionsFor(8).map((o) => o.value)).toContain("8");
    expect(fontSizeOptionsFor(32).map((o) => o.value)).toContain("32");
    // Below the smallest preset it sorts first; above the largest, last.
    expect(fontSizeOptionsFor(8)[0].value).toBe("8");
    expect(fontSizeOptionsFor(32).at(-1)?.value).toBe("32");
  });

  it("ignores a non-finite current value rather than injecting NaN", () => {
    expect(fontSizeOptionsFor(Number.NaN)).toEqual(fontSizeOptions);
    expect(fontSizeOptionsFor(Number.POSITIVE_INFINITY)).toEqual(fontSizeOptions);
  });

  it("injects a fractional value with its exact label", () => {
    const opts = fontSizeOptionsFor(13.5);
    expect(opts.map((o) => o.value)).toContain("13.5");
    expect(opts.find((o) => o.value === "13.5")?.label).toBe("13.5px");
  });
});

describe("shellLabel", () => {
  it("extracts the basename from POSIX and Windows paths", () => {
    expect(shellLabel("/bin/zsh")).toBe("zsh");
    expect(shellLabel("C:\\Windows\\System32\\cmd.exe")).toBe("cmd.exe");
  });

  it("returns the input when there is no separator", () => {
    expect(shellLabel("zsh")).toBe("zsh");
  });

  it("returns the input for an empty or trailing-separator path", () => {
    expect(shellLabel("")).toBe("");
    expect(shellLabel("/bin/")).toBe("/bin/");
  });
});

describe("withCurrentNumericOption (audit-fix — generalizes WI-1.3)", () => {
  // The same defect T3 described applies to EVERY numeric terminal select:
  // each clamp range is wider than its preset list, so a persisted or
  // hand-edited value can fall outside the options and make a native <select>
  // render (and then write back) a different number.
  const OPTS = [
    { value: "1", label: "one" },
    { value: "4.5", label: "four-five" },
    { value: "7", label: "seven" },
  ];

  it("returns the list untouched when the value matches an option", () => {
    expect(withCurrentNumericOption(OPTS, 4.5, String)).toEqual(OPTS);
  });

  it("injects an unmatched value, formatted by the caller", () => {
    const out = withCurrentNumericOption(OPTS, 5, (v) => `${v}:1`);
    expect(out.find((o) => o.value === "5")?.label).toBe("5:1");
  });

  it("keeps the list in ascending numeric order", () => {
    const out = withCurrentNumericOption(OPTS, 5, String);
    expect(out.map((o) => Number(o.value))).toEqual([1, 4.5, 5, 7]);
  });

  it("ignores a non-finite value rather than injecting NaN", () => {
    expect(withCurrentNumericOption(OPTS, Number.NaN, String)).toEqual(OPTS);
    expect(withCurrentNumericOption(OPTS, Infinity, String)).toEqual(OPTS);
  });

  it("covers line height beyond its preset range (clamp allows 2.5)", () => {
    const opts = lineHeightChoices.map((c) => ({
      value: c.value.toFixed(1),
      label: c.labelKey,
    }));
    const out = withCurrentNumericOption(opts, 2.5, (v) => v.toFixed(1));
    expect(out.map((o) => o.value)).toContain("2.5");
  });

  it("covers scrollback beyond its preset range (clamp allows 200000)", () => {
    const opts = [{ value: "1000", label: "1,000" }];
    const out = withCurrentNumericOption(opts, 200000, (v) => v.toLocaleString());
    expect(out.map((o) => o.value)).toContain("200000");
  });
});

describe("lineHeightChoices (audit-fix)", () => {
  it("pairs each value with its label key, so neither can drift", () => {
    // Previously two parallel arrays: reordering one silently mislabeled every
    // entry after the edit.
    expect(lineHeightChoices.map((c) => c.value)).toEqual([...lineHeightValues]);
    for (const { labelKey } of lineHeightChoices) {
      expect(labelKey).toMatch(/^[a-z]+$/);
    }
  });

  it("has a unique label key per entry", () => {
    const keys = lineHeightChoices.map((c) => c.labelKey);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
