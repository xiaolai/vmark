/**
 * Appearance Settings Section
 *
 * Theme and window configuration.
 */

import {
  useSettingsStore,
  themes,
  type ThemeId,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Toggle } from "./components";

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

      {/* Window */}
      <SettingsGroup title="Window">
        <SettingRow
          label="Show filename in titlebar"
          description="Display the current file name in the window title"
        >
          <Toggle
            checked={appearance.showFilenameInTitlebar ?? false}
            onChange={(v) => updateSetting("showFilenameInTitlebar", v)}
          />
        </SettingRow>
        <SettingRow
          label="Auto-hide status bar"
          description="Hide status bar when not interacting"
        >
          <Toggle
            checked={appearance.autoHideStatusBar ?? false}
            onChange={(v) => updateSetting("autoHideStatusBar", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
