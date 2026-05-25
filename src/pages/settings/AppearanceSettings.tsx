/**
 * Appearance Settings Section
 *
 * Theme and window configuration.
 */

import { useTranslation } from "react-i18next";
import {
  useSettingsStore,
  themes,
  type ThemeId,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Toggle } from "./components";

export function AppearanceSettings() {
  const { t } = useTranslation("settings");
  const appearance = useSettingsStore((state) => state.appearance);
  const updateSetting = useSettingsStore(
    (state) => state.updateAppearanceSetting
  );

  return (
    <div>
      {/* Theme selector */}
      <SettingsGroup title={t("appearance.group.theme")}>
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
                  ? "text-[var(--text-color)]"
                  : "text-[var(--text-tertiary)]"
              }`}>
                {t(`appearance.theme.${id}`, id)}
              </span>
            </button>
          ))}
        </div>
      </SettingsGroup>

      {/* Window */}
      <SettingsGroup title={t("appearance.group.window")}>
        <SettingRow
          label={t("appearance.showFilenameInTitlebar.label")}
          description={t("appearance.showFilenameInTitlebar.description")}
        >
          <Toggle
            checked={appearance.showFilenameInTitlebar ?? false}
            onChange={(v) => updateSetting("showFilenameInTitlebar", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("appearance.autoHideStatusBar.label")}
          description={t("appearance.autoHideStatusBar.description")}
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
