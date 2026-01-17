/**
 * Terminal Settings Section
 *
 * Configuration for the integrated terminal panel.
 */

import {
  useSettingsStore,
  type TerminalShell,
  type TerminalFontSize,
  type TerminalCursorStyle,
  type TerminalMarkdownMode,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";

const shellOptions: { value: TerminalShell; label: string }[] = [
  { value: "system", label: "System Default" },
  { value: "bash", label: "Bash" },
  { value: "zsh", label: "Zsh" },
  { value: "fish", label: "Fish" },
  { value: "powershell", label: "PowerShell" },
];

const fontSizeOptions: { value: string; label: string }[] = [
  { value: "12", label: "12px" },
  { value: "13", label: "13px" },
  { value: "14", label: "14px" },
  { value: "15", label: "15px" },
  { value: "16", label: "16px" },
];

const cursorStyleOptions: { value: TerminalCursorStyle; label: string }[] = [
  { value: "bar", label: "Bar" },
  { value: "block", label: "Block" },
  { value: "underline", label: "Underline" },
];

const scrollbackOptions: { value: string; label: string }[] = [
  { value: "1000", label: "1,000 lines" },
  { value: "2500", label: "2,500 lines" },
  { value: "5000", label: "5,000 lines" },
  { value: "10000", label: "10,000 lines" },
];

const markdownModeOptions: { value: TerminalMarkdownMode; label: string }[] = [
  { value: "ansi", label: "ANSI Styled" },
  { value: "overlay", label: "Rich Overlay" },
  { value: "off", label: "Off" },
];

export function TerminalSettings() {
  const terminal = useSettingsStore((state) => state.terminal);
  const updateSetting = useSettingsStore((state) => state.updateTerminalSetting);

  return (
    <div>
      {/* Shell */}
      <SettingsGroup title="Shell">
        <SettingRow
          label="Default Shell"
          description="Shell to use when opening new terminals"
        >
          <Select
            value={terminal.shell}
            options={shellOptions}
            onChange={(v) => updateSetting("shell", v as TerminalShell)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Appearance */}
      <SettingsGroup title="Appearance">
        <SettingRow label="Font Size">
          <Select
            value={String(terminal.fontSize)}
            options={fontSizeOptions}
            onChange={(v) => updateSetting("fontSize", Number(v) as TerminalFontSize)}
          />
        </SettingRow>
        <SettingRow label="Cursor Style">
          <Select
            value={terminal.cursorStyle}
            options={cursorStyleOptions}
            onChange={(v) => updateSetting("cursorStyle", v as TerminalCursorStyle)}
          />
        </SettingRow>
        <SettingRow label="Cursor Blink">
          <Toggle
            checked={terminal.cursorBlink}
            onChange={(v) => updateSetting("cursorBlink", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Behavior */}
      <SettingsGroup title="Behavior">
        <SettingRow
          label="Scrollback"
          description="Number of lines to keep in history"
        >
          <Select
            value={String(terminal.scrollback)}
            options={scrollbackOptions}
            onChange={(v) => updateSetting("scrollback", Number(v))}
          />
        </SettingRow>
        <SettingRow
          label="Copy on Select"
          description="Automatically copy selected text"
        >
          <Toggle
            checked={terminal.copyOnSelect}
            onChange={(v) => updateSetting("copyOnSelect", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Markdown */}
      <SettingsGroup title="AI Output">
        <SettingRow
          label="Markdown Rendering"
          description="How to display markdown in terminal output"
        >
          <Select
            value={terminal.markdownMode}
            options={markdownModeOptions}
            onChange={(v) => updateSetting("markdownMode", v as TerminalMarkdownMode)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
