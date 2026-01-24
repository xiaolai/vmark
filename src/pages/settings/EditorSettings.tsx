/**
 * Editor Settings Section
 *
 * Typography, display, behavior, and whitespace configuration.
 */

import {
  useSettingsStore,
  type AppearanceSettings as AppearanceSettingsType,
  type AutoPairCJKStyle,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";

/** Shared option for system default */
const SYSTEM_DEFAULT = { value: "system", label: "System Default" };

/** Font option definitions */
const fontOptions = {
  latin: [
    SYSTEM_DEFAULT,
    { value: "athelas", label: "Athelas" },
    { value: "palatino", label: "Palatino" },
    { value: "georgia", label: "Georgia" },
    { value: "charter", label: "Charter" },
    { value: "literata", label: "Literata" },
  ],
  cjk: [
    SYSTEM_DEFAULT,
    { value: "pingfang", label: "PingFang SC" },
    { value: "songti", label: "Songti SC" },
    { value: "kaiti", label: "Kaiti SC" },
    { value: "notoserif", label: "Noto Serif CJK" },
    { value: "sourcehans", label: "Source Han Sans" },
  ],
  mono: [
    SYSTEM_DEFAULT,
    { value: "sfmono", label: "SF Mono" },
    { value: "monaco", label: "Monaco" },
    { value: "menlo", label: "Menlo" },
    { value: "consolas", label: "Consolas" },
    { value: "jetbrains", label: "JetBrains Mono" },
    { value: "firacode", label: "Fira Code" },
    { value: "saucecodepro", label: "SauceCodePro NFM" },
    { value: "ibmplexmono", label: "IBM Plex Mono" },
    { value: "hack", label: "Hack" },
    { value: "inconsolata", label: "Inconsolata" },
  ],
};

/** Numeric option definitions */
const numericOptions = {
  fontSize: [
    { value: "14", label: "14px" },
    { value: "16", label: "16px" },
    { value: "18", label: "18px" },
    { value: "20", label: "20px" },
    { value: "22", label: "22px" },
  ],
  lineHeight: [
    { value: "1.4", label: "1.4 (Compact)" },
    { value: "1.6", label: "1.6 (Normal)" },
    { value: "1.8", label: "1.8 (Relaxed)" },
    { value: "2.0", label: "2.0 (Spacious)" },
    { value: "2.2", label: "2.2 (Extra)" },
  ],
  paragraphSpacing: [
    { value: "0.5", label: "0.5em (Tight)" },
    { value: "1", label: "1em (Normal)" },
    { value: "1.5", label: "1.5em (Relaxed)" },
    { value: "2", label: "2em (Spacious)" },
  ],
  editorWidth: [
    { value: "36", label: "36em (Compact)" },
    { value: "42", label: "42em (Narrow)" },
    { value: "50", label: "50em (Medium)" },
    { value: "60", label: "60em (Wide)" },
    { value: "80", label: "80em (Extra Wide)" },
    { value: "0", label: "Unlimited" },
  ],
};

/** Typography settings configuration for data-driven rendering */
type TypographyConfig = {
  label: string;
  key: keyof AppearanceSettingsType;
  options: { value: string; label: string }[];
  isNumeric: boolean;
};

const typographySettings: TypographyConfig[] = [
  { label: "Latin Font", key: "latinFont", options: fontOptions.latin, isNumeric: false },
  { label: "CJK Font", key: "cjkFont", options: fontOptions.cjk, isNumeric: false },
  { label: "Mono Font", key: "monoFont", options: fontOptions.mono, isNumeric: false },
  { label: "Font Size", key: "fontSize", options: numericOptions.fontSize, isNumeric: true },
  { label: "Line Height", key: "lineHeight", options: numericOptions.lineHeight, isNumeric: true },
  { label: "Paragraph Spacing", key: "paragraphSpacing", options: numericOptions.paragraphSpacing, isNumeric: true },
];

export function EditorSettings() {
  const appearance = useSettingsStore((state) => state.appearance);
  const general = useSettingsStore((state) => state.general);
  const markdown = useSettingsStore((state) => state.markdown);
  const updateAppearanceSetting = useSettingsStore((state) => state.updateAppearanceSetting);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);
  const updateMarkdownSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  // Normalize optional settings
  const autoPairEnabled = markdown.autoPairEnabled ?? true;
  const autoPairCJKStyle = markdown.autoPairCJKStyle ?? "auto";

  return (
    <div>
      {/* Typography */}
      <SettingsGroup title="Typography">
        {typographySettings.map(({ label, key, options, isNumeric }) => (
          <SettingRow key={key} label={label}>
            <Select
              value={String(appearance[key])}
              options={options}
              onChange={(v) =>
                updateAppearanceSetting(key, isNumeric ? Number(v) : v)
              }
            />
          </SettingRow>
        ))}
      </SettingsGroup>

      {/* Display */}
      <SettingsGroup title="Display">
        <SettingRow label="Editor Width" description="Maximum content width">
          <Select
            value={String(appearance.editorWidth)}
            options={numericOptions.editorWidth}
            onChange={(v) => updateAppearanceSetting("editorWidth", Number(v))}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Behavior */}
      <SettingsGroup title="Behavior">
        <SettingRow
          label="Tab size"
          description="Number of spaces inserted when pressing Tab"
        >
          <Select
            value={String(general.tabSize)}
            options={[
              { value: "2", label: "2 spaces" },
              { value: "4", label: "4 spaces" },
            ]}
            onChange={(v) => updateGeneralSetting("tabSize", Number(v))}
          />
        </SettingRow>
        <SettingRow
          label="Enable auto-pairing"
          description="Automatically insert closing brackets and quotes"
        >
          <Toggle
            checked={autoPairEnabled}
            onChange={(v) => updateMarkdownSetting("autoPairEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="CJK brackets"
          description='Auto-pair CJK brackets like 「」【】《》'
          disabled={!autoPairEnabled}
        >
          <Select<AutoPairCJKStyle>
            value={autoPairCJKStyle}
            options={[
              { value: "off", label: "Off" },
              { value: "auto", label: "Auto" },
            ]}
            onChange={(v) => updateMarkdownSetting("autoPairCJKStyle", v)}
            disabled={!autoPairEnabled}
          />
        </SettingRow>
        {autoPairCJKStyle !== "off" && (
          <SettingRow
            label="Include curly quotes"
            description={`Auto-pair \u201C\u201D and \u2018\u2019 (may conflict with IME smart quotes)`}
            disabled={!autoPairEnabled}
          >
            <Toggle
              checked={markdown.autoPairCurlyQuotes ?? false}
              onChange={(v) => updateMarkdownSetting("autoPairCurlyQuotes", v)}
              disabled={!autoPairEnabled}
            />
          </SettingRow>
        )}
      </SettingsGroup>

      {/* Whitespace */}
      <SettingsGroup title="Whitespace">
        <SettingRow
          label="Line endings on save"
          description="Preserve original line endings or normalize on save"
        >
          <Select
            value={general.lineEndingsOnSave}
            options={[
              { value: "preserve", label: "Preserve existing" },
              { value: "lf", label: "LF (\\n)" },
              { value: "crlf", label: "CRLF (\\r\\n)" },
            ]}
            onChange={(v) => updateGeneralSetting("lineEndingsOnSave", v as typeof general.lineEndingsOnSave)}
          />
        </SettingRow>
        <SettingRow
          label="Preserve consecutive line breaks"
          description="Keep multiple blank lines as-is (don't collapse)"
        >
          <Toggle
            checked={markdown.preserveLineBreaks}
            onChange={(v) => updateMarkdownSetting("preserveLineBreaks", v)}
          />
        </SettingRow>
        <SettingRow
          label="Hard break style on save"
          description="Preserve source style or normalize hard line breaks"
        >
          <Select
            value={markdown.hardBreakStyleOnSave}
            options={[
              { value: "preserve", label: "Preserve existing" },
              { value: "backslash", label: "Backslash (\\\\)" },
              { value: "twoSpaces", label: "Two spaces" },
            ]}
            onChange={(v) => updateMarkdownSetting("hardBreakStyleOnSave", v as typeof markdown.hardBreakStyleOnSave)}
          />
        </SettingRow>
        <SettingRow
          label="Show <br> tags"
          description="Display HTML line break tags visibly in editor"
        >
          <Toggle
            checked={markdown.showBrTags}
            onChange={(v) => updateMarkdownSetting("showBrTags", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
