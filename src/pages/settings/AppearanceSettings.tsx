/**
 * Appearance Settings Section
 *
 * Theme and typography configuration.
 */

import {
  useSettingsStore,
  themes,
  type ThemeId,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select } from "./components";

const themeLabels: Record<ThemeId, string> = {
  white: "White",
  paper: "Paper",
  mint: "Mint",
  sepia: "Sepia",
  night: "Night",
};

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
                {themeLabels[id]}
              </span>
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Typography */}
      <SettingsGroup title="Typography">
        <SettingRow label="Latin Font">
          <Select
            value={appearance.latinFont}
            options={[
              { value: "system", label: "System Default" },
              { value: "athelas", label: "Athelas" },
              { value: "palatino", label: "Palatino" },
              { value: "georgia", label: "Georgia" },
              { value: "charter", label: "Charter" },
              { value: "literata", label: "Literata" },
            ]}
            onChange={(v) => updateSetting("latinFont", v)}
          />
        </SettingRow>
        <SettingRow label="CJK Font">
          <Select
            value={appearance.cjkFont}
            options={[
              { value: "system", label: "System Default" },
              { value: "pingfang", label: "PingFang SC" },
              { value: "songti", label: "Songti SC" },
              { value: "kaiti", label: "Kaiti SC" },
              { value: "notoserif", label: "Noto Serif CJK" },
              { value: "sourcehans", label: "Source Han Sans" },
            ]}
            onChange={(v) => updateSetting("cjkFont", v)}
          />
        </SettingRow>
        <SettingRow label="Mono Font">
          <Select
            value={appearance.monoFont}
            options={[
              { value: "system", label: "System Default" },
              { value: "firacode", label: "Fira Code" },
              { value: "jetbrains", label: "JetBrains Mono" },
              { value: "sourcecodepro", label: "Source Code Pro" },
              { value: "consolas", label: "Consolas" },
              { value: "inconsolata", label: "Inconsolata" },
            ]}
            onChange={(v) => updateSetting("monoFont", v)}
          />
        </SettingRow>
        <SettingRow label="Font Size">
          <Select
            value={String(appearance.fontSize)}
            options={[
              { value: "14", label: "14px" },
              { value: "16", label: "16px" },
              { value: "18", label: "18px" },
              { value: "20", label: "20px" },
              { value: "22", label: "22px" },
            ]}
            onChange={(v) => updateSetting("fontSize", Number(v))}
          />
        </SettingRow>
        <SettingRow label="Line Height">
          <Select
            value={String(appearance.lineHeight)}
            options={[
              { value: "1.4", label: "1.4 (Compact)" },
              { value: "1.6", label: "1.6 (Normal)" },
              { value: "1.8", label: "1.8 (Relaxed)" },
              { value: "2.0", label: "2.0 (Spacious)" },
            ]}
            onChange={(v) => updateSetting("lineHeight", Number(v))}
          />
        </SettingRow>
        <SettingRow label="Paragraph Spacing">
          <Select
            value={String(appearance.paragraphSpacing)}
            options={[
              { value: "0.5", label: "0.5em (Tight)" },
              { value: "1", label: "1em (Normal)" },
              { value: "1.5", label: "1.5em (Relaxed)" },
              { value: "2", label: "2em (Spacious)" },
            ]}
            onChange={(v) => updateSetting("paragraphSpacing", Number(v))}
          />
        </SettingRow>
        <SettingRow label="Editor Width">
          <Select
            value={String(appearance.editorWidth)}
            options={[
              { value: "60", label: "60em (Narrow)" },
              { value: "80", label: "80em (Medium)" },
              { value: "100", label: "100em (Wide)" },
              { value: "120", label: "120em (Extra Wide)" },
              { value: "0", label: "Unlimited" },
            ]}
            onChange={(v) => updateSetting("editorWidth", Number(v))}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
