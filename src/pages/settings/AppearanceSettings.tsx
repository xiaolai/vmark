/**
 * Appearance Settings Section
 *
 * Theme and window configuration. The theme group offers manual selection,
 * or — with follow-system-appearance on (#1125) — a paired light/dark theme
 * that auto-switches with the OS.
 */

import { useTranslation } from "react-i18next";
import {
  useSettingsStore,
  themes,
  type ThemeId,
  type FocusModeDim,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Toggle, Select } from "./components";
import { selectableThemeIds } from "@/theme/themeAvailability";
import { isMacPlatform, usesOverlayTitleBar } from "@/utils/platform";

/** One row of theme swatches. `selected` gets the ring indicator. */
function ThemeSwatchRow({
  selected,
  onSelect,
}: {
  selected: ThemeId;
  onSelect: (id: ThemeId) => void;
}) {
  const { t } = useTranslation("settings");
  // Windows/Linux offer only the light/dark pair their native chrome can
  // actually match — see theme/themeAvailability.ts.
  const available = selectableThemeIds(isMacPlatform());
  return (
    <div className="flex items-center gap-4 pb-3">
      {available.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onSelect(id)}
          className="flex flex-col items-center gap-1.5"
        >
          <div
            className={`w-6 h-6 rounded-full transition-all ${
              selected === id
                ? "ring-1 ring-offset-2 ring-gray-400 dark:ring-gray-500"
                : "hover:scale-110"
            }`}
            style={{
              backgroundColor: themes[id].background,
              border: `1px solid ${themes[id].border}`,
            }}
          />
          <span
            className={`text-xs ${
              selected === id
                ? "text-[var(--text-color)]"
                : "text-[var(--text-tertiary)]"
            }`}
          >
            {t(`appearance.theme.${id}`, id)}
          </span>
        </button>
      ))}
    </div>
  );
}

export function AppearanceSettings() {
  const { t } = useTranslation("settings");
  const appearance = useSettingsStore((state) => state.appearance);
  const updateSetting = useSettingsStore(
    (state) => state.updateAppearanceSetting
  );
  const followSystem = appearance.followSystemAppearance ?? false;

  return (
    <div>
      {/* Theme selector */}
      <SettingsGroup title={t("appearance.group.theme")}>
        {followSystem ? (
          <>
            <div className="text-xs font-medium text-[var(--text-secondary)] pb-1.5">
              {t("appearance.systemLightTheme.label")}
            </div>
            <ThemeSwatchRow
              selected={appearance.systemLightTheme}
              onSelect={(id) => updateSetting("systemLightTheme", id)}
            />
            <div className="text-xs font-medium text-[var(--text-secondary)] pb-1.5">
              {t("appearance.systemDarkTheme.label")}
            </div>
            <ThemeSwatchRow
              selected={appearance.systemDarkTheme}
              onSelect={(id) => updateSetting("systemDarkTheme", id)}
            />
          </>
        ) : (
          <ThemeSwatchRow
            selected={appearance.theme}
            onSelect={(id) => updateSetting("theme", id)}
          />
        )}
        <SettingRow
          label={t("appearance.followSystem.label")}
          description={t("appearance.followSystem.description")}
        >
          <Toggle
            checked={followSystem}
            onChange={(v) => updateSetting("followSystemAppearance", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Window */}
      <SettingsGroup title={t("appearance.group.window")}>
        {/* The toggle governs the app's own title-bar strip, which is drawn
            only where it covers the native one. Off macOS the filename goes in
            the native title bar unconditionally, so there is nothing to choose
            (#1296). */}
        {usesOverlayTitleBar() && (
          <SettingRow
            label={t("appearance.showFilenameInTitlebar.label")}
            description={t("appearance.showFilenameInTitlebar.description")}
          >
            <Toggle
              checked={appearance.showFilenameInTitlebar ?? false}
              onChange={(v) => updateSetting("showFilenameInTitlebar", v)}
            />
          </SettingRow>
        )}
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

      {/* Focus Mode */}
      <SettingsGroup title={t("appearance.group.focusMode")}>
        <SettingRow
          label={t("appearance.focusModeDim.label")}
          description={t("appearance.focusModeDim.description")}
        >
          <Select<FocusModeDim>
            value={appearance.focusModeDim ?? "standard"}
            options={[
              { value: "standard", label: t("appearance.focusModeDim.standard") },
              { value: "strong", label: t("appearance.focusModeDim.strong") },
              { value: "stronger", label: t("appearance.focusModeDim.stronger") },
            ]}
            onChange={(v) => updateSetting("focusModeDim", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
