/**
 * Pure option arrays and helpers for TerminalSettings. Extracted to keep the
 * component under the 300-line limit; no i18n, no store — raw data + string ops.
 *
 * @module pages/settings/terminalSettingsHelpers
 */

/** Panel-size dropdown values (fraction of available space). */
export const panelSizeOptions = [
  { value: "0.1", label: "10%" },
  { value: "0.15", label: "15%" },
  { value: "0.2", label: "20%" },
  { value: "0.25", label: "25%" },
  { value: "0.3", label: "30%" },
  { value: "0.35", label: "35%" },
  { value: "0.4", label: "40%" },
  { value: "0.45", label: "45%" },
  { value: "0.5", label: "50%" },
  { value: "0.6", label: "60%" },
  { value: "0.7", label: "70%" },
  { value: "0.8", label: "80%" },
];

/** Scrollback line-count options — raw numeric labels (no translation). */
export const scrollbackOptions = [
  { value: "1000", label: "1,000" },
  { value: "5000", label: "5,000" },
  { value: "10000", label: "10,000" },
  { value: "50000", label: "50,000" },
];

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
