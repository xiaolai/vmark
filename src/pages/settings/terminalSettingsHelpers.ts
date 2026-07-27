/**
 * Pure option arrays and helpers for TerminalSettings. Extracted to keep the
 * component under the 300-line limit; no i18n, no store state — raw data +
 * string ops (the one store import is a plain layout constant, not a hook).
 *
 * Key decisions:
 *   - Panel-size options are DERIVED from TERMINAL_MAX_RATIO rather than
 *     hand-listed (WI-1.2). The list used to run to 80% while the layout
 *     capped at 50% in three independent places, so the top three entries
 *     rendered identically to 50% and a drag silently rewrote the stored
 *     value. Deriving them means raising the cap can never strand the
 *     dropdown again. The honest answer to "I want 80%" is the maximize
 *     toggle, not a persisted ratio that squeezes the editor out.
 *   - Font-size options are a FUNCTION of the current value (WI-1.3), because
 *     Mod +/- zooms freely (step 2 from a default of 13 → 15, 17, …) while the
 *     presets are a curated subset. A native <select> whose `value` matches no
 *     option renders its first entry, so an unmatched zoom used to display
 *     "10px" and write 10 on the next interaction. Mirrors the existing
 *     `shellOptions` synthetic-entry pattern in TerminalSettings.tsx.
 *
 * @coordinates-with TerminalSettings.tsx — sole consumer
 * @coordinates-with components/Terminal/useTerminalPosition.ts — enforces the same cap
 * @module pages/settings/terminalSettingsHelpers
 */
import { TERMINAL_MAX_RATIO } from "@/stores/uiStore";

/** Step between panel-size options, as a fraction of available space. */
const PANEL_SIZE_STEP = 0.05;
/** Smallest offered panel share. */
const PANEL_SIZE_MIN = 0.1;

/**
 * Panel-size dropdown values (fraction of available space), derived from the
 * layout cap so no offered value can be silently clamped. Floating-point steps
 * are rounded to 2 decimals — 0.1 + 0.05*3 is 0.25000000000000006 otherwise,
 * which would never match a persisted 0.25.
 */
export const panelSizeOptions = Array.from(
  { length: Math.round((TERMINAL_MAX_RATIO - PANEL_SIZE_MIN) / PANEL_SIZE_STEP) + 1 },
  (_, i) => {
    const value = Math.round((PANEL_SIZE_MIN + i * PANEL_SIZE_STEP) * 100) / 100;
    return { value: String(value), label: `${Math.round(value * 100)}%` };
  },
);

/** Scrollback line-count options — raw numeric labels (no translation). */
export const scrollbackOptions = [
  { value: "1000", label: "1,000" },
  { value: "5000", label: "5,000" },
  { value: "10000", label: "10,000" },
  { value: "50000", label: "50,000" },
];

/**
 * Line-height options: value paired with its translation-key suffix. Kept as
 * ONE structure rather than two parallel arrays — reordering or extending
 * parallel arrays silently mislabels every entry after the edit. The numbers
 * live here so the published range in `website/guide/terminal.md` can be
 * checked against what the dropdown actually offers (WI-2.2).
 */
export const lineHeightChoices = [
  { value: 1.0, labelKey: "tight" },
  { value: 1.2, labelKey: "compact" },
  { value: 1.4, labelKey: "normal" },
  { value: 1.6, labelKey: "relaxed" },
  { value: 1.8, labelKey: "spacious" },
  { value: 2.0, labelKey: "extra" },
] as const;

/** Just the line-height numbers — used by the doc↔range guard (WI-2.2). */
export const lineHeightValues = lineHeightChoices.map((c) => c.value);

/** Font-size options — raw px labels (no translation). */
export const fontSizeOptions = [
  { value: "10", label: "10px" },
  { value: "11", label: "11px" },
  { value: "12", label: "12px" },
  { value: "13", label: "13px" },
  { value: "14", label: "14px" },
  { value: "16", label: "16px" },
  { value: "18", label: "18px" },
  { value: "20", label: "20px" },
  { value: "24", label: "24px" },
];

/**
 * Ensure a numeric `<select>` can always display the value the store actually
 * holds. A native `<select>` whose `value` matches no option renders its FIRST
 * option instead — so an out-of-preset value shows a different number than the
 * one in effect, and touching the control writes that wrong number back (T3).
 *
 * Every numeric terminal select needs this, not just font size: the clamp
 * ranges are wider than the preset lists (line height clamps to 2.5 but stops
 * at 2.0; scrollback clamps to 200 000 but stops at 50 000; contrast clamps to
 * 21 but offers four fixed steps), so corrupt or hand-edited persisted state
 * lands outside the options for any of them.
 *
 * Returns the preset list untouched when `current` already matches one, or is
 * not a usable number.
 */
export function withCurrentNumericOption(
  options: Array<{ value: string; label: string }>,
  current: number,
  formatLabel: (value: number) => string,
): Array<{ value: string; label: string }> {
  if (!Number.isFinite(current)) return options;
  if (options.some((o) => Number(o.value) === current)) return options;
  return [...options, { value: String(current), label: formatLabel(current) }].sort(
    (a, b) => Number(a.value) - Number(b.value),
  );
}

/**
 * Font-size options with `current` injected when free zoom (`Mod +/-`) has
 * landed outside the presets (WI-1.3).
 */
export function fontSizeOptionsFor(
  current: number,
): Array<{ value: string; label: string }> {
  return withCurrentNumericOption(fontSizeOptions, current, (v) => `${v}px`);
}

/** Extract shell name from an absolute path ("/bin/zsh" → "zsh", "C:\\...\\cmd.exe" → "cmd.exe"). */
export function shellLabel(path: string): string {
  const name = path.split(/[/\\]/).pop() ?? path;
  return name || path;
}

/** Snap a ratio to the nearest panel-size dropdown value. */
export function snapToOption(ratio: number): string {
  const values = panelSizeOptions.map((o) => Number(o.value));
  let closest = values[0];
  let minDiff = Math.abs(ratio - closest);
  for (const v of values) {
    const diff = Math.abs(ratio - v);
    if (diff < minDiff) {
      minDiff = diff;
      closest = v;
    }
  }
  return String(closest);
}
