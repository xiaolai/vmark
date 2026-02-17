/**
 * Terminal Settings Section
 *
 * Panel position, panel size, font size, line height, and other terminal options.
 */

import { useSettingsStore, type TerminalPosition } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";

const positionOptions = [
  { value: "auto", label: "Auto (based on window shape)" },
  { value: "bottom", label: "Bottom" },
  { value: "right", label: "Right" },
];

const panelSizeOptions = [
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

const fontSizeOptions = [
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

const lineHeightOptions = [
  { value: "1.0", label: "1.0 (Tight)" },
  { value: "1.2", label: "1.2 (Compact)" },
  { value: "1.4", label: "1.4 (Normal)" },
  { value: "1.6", label: "1.6 (Relaxed)" },
  { value: "1.8", label: "1.8 (Spacious)" },
  { value: "2.0", label: "2.0 (Extra)" },
];

/** Snap a ratio to the nearest dropdown option value. */
function snapToOption(ratio: number): string {
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

export function TerminalSettings() {
  const terminal = useSettingsStore((state) => state.terminal);
  const updateTerminalSetting = useSettingsStore((state) => state.updateTerminalSetting);

  return (
    <div className="space-y-6">
      <SettingsGroup title="Terminal">
        <SettingRow label="Panel Position" description="Where to place the terminal panel. Auto switches based on window aspect ratio.">
          <Select
            value={terminal.position}
            options={positionOptions}
            onChange={(v) => updateTerminalSetting("position", v as TerminalPosition)}
          />
        </SettingRow>

        <SettingRow label="Panel Size" description="Proportion of available space. Drag-resizing the panel also updates this value.">
          <Select
            value={snapToOption(terminal.panelRatio)}
            options={panelSizeOptions}
            onChange={(v) => updateTerminalSetting("panelRatio", Number(v))}
          />
        </SettingRow>

        <SettingRow label="Font Size" description="Text size in the terminal">
          <Select
            value={String(terminal.fontSize)}
            options={fontSizeOptions}
            onChange={(v) => updateTerminalSetting("fontSize", Number(v))}
          />
        </SettingRow>

        <SettingRow label="Line Height" description="Spacing between terminal lines">
          <Select
            value={String(terminal.lineHeight)}
            options={lineHeightOptions}
            onChange={(v) => updateTerminalSetting("lineHeight", Number(v))}
          />
        </SettingRow>

        <SettingRow label="Copy on Select" description="Automatically copy selected text to clipboard">
          <Toggle
            checked={terminal.copyOnSelect}
            onChange={(v) => updateTerminalSetting("copyOnSelect", v)}
          />
        </SettingRow>

        <SettingRow label="WebGL Renderer" description="Use GPU-accelerated rendering. Disable if you experience IME input issues. Requires terminal restart.">
          <Toggle
            checked={terminal.useWebGL}
            onChange={(v) => updateTerminalSetting("useWebGL", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
