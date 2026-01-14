/**
 * Appearance Settings Section
 *
 * Theme and typography configuration.
 */

import {
  useSettingsStore,
  themes,
  type ThemeId,
  type AppearanceSettings as AppearanceSettingsType,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select } from "./components";

const themeLabels: Record<ThemeId, string> = {
  white: "White",
  paper: "Paper",
  mint: "Mint",
  sepia: "Sepia",
  night: "Night",
};

/** Shared option for system default */
const SYSTEM_DEFAULT = { value: "system", label: "System Default" };

/** Font option definitions (extracted to avoid recreation on each render) */
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
    { value: "firacode", label: "Fira Code" },
    { value: "jetbrains", label: "JetBrains Mono" },
    { value: "sourcecodepro", label: "Source Code Pro" },
    { value: "consolas", label: "Consolas" },
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
  { label: "Editor Width", key: "editorWidth", options: numericOptions.editorWidth, isNumeric: true },
];

export function AppearanceSettings() {
  const appearance = useSettingsStore((state) => state.appearance);
  const updateSetting = useSettingsStore(
    (state) => state.updateAppearanceSetting
  );

  return (
    <div>
      {/* Theme selector */}
      <SettingsGroup title="Theme">
        <div className="flex items-center gap-4 pb-3">
          {(Object.keys(themes) as ThemeId[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => updateSetting("theme", id)}
              className="flex flex-col items-center gap-1.5"
            >
              <div
                className={`w-6 h-6 rounded-full transition-all ${
                  appearance.theme === id
                    ? "ring-1 ring-offset-2 ring-gray-400 dark:ring-gray-500"
                    : "hover:scale-110"
                }`}
                style={{
                  backgroundColor: themes[id].background,
                  border: `1px solid ${themes[id].border}`,
                }}
              />
              <span className={`text-xs ${
                appearance.theme === id
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)]"
              }`}>
                {themeLabels[id] ?? id}
              </span>
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Typography */}
      <SettingsGroup title="Typography">
        {typographySettings.map(({ label, key, options, isNumeric }) => (
          <SettingRow key={key} label={label}>
            <Select
              value={String(appearance[key])}
              options={options}
              onChange={(v) =>
                updateSetting(key, isNumeric ? Number(v) : v)
              }
            />
          </SettingRow>
        ))}
      </SettingsGroup>
    </div>
  );
}
