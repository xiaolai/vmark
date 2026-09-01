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
  type ThemeId,
  type FocusModeDim,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Toggle, Select } from "./components";
import { selectableThemeIds } from "@/theme/themeAvailability";
import { themes as themeCatalog } from "@/theme/themes";
import { isMacPlatform, usesOverlayTitleBar } from "@/utils/platform";

/** One row of theme swatches (WI-UI4.6): each swatch is a MINI PAGE from the
 *  typed catalog — an "Aa" specimen in the theme's ink on its paper, a
 *  hairline in its border and a 2px rule in its accent — so night/solarized
 *  stay legible on a night page (the specimen carries the identity where a
 *  flat fill would sit at 1.00:1). The swatch is a MINI WINDOW, so its
 *  radius is the popup/window family (--radius-lg), and `selected` is a
 *  LIFT — the theme-adaptive popup shadow — not a box around the page
 *  (maintainer direction 2026-09-02). */
function ThemeSwatchRow({
  selected,
  onSelect,
  mode,
}: {
  selected: ThemeId;
  onSelect: (id: ThemeId) => void;
  /** Paired rows (#1125) offer only THEIR mode — both rows listing all six
   *  read as an inexplicable duplicate (maintainer, 2026-09-02). Absent in
   *  manual mode, where one mixed row shows everything. */
  mode?: "light" | "dark";
}) {
  const { t } = useTranslation("settings");
  // Windows/Linux offer only the light/dark pair their native chrome can
  // actually match — see theme/themeAvailability.ts.
  const available = selectableThemeIds(isMacPlatform()).filter(
    (id) => !mode || themeCatalog[id].isDark === (mode === "dark"),
  );
  return (
    <div className="flex items-start gap-4 pb-3">
      {available.map((id) => {
        const tk = themeCatalog[id];
        return (
          <button
            key={id}
            type="button"
            onClick={() => onSelect(id)}
            aria-pressed={selected === id}
            title={t(`appearance.theme.${id}.description`, "")}
            className="flex flex-col items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent-primary)] focus-visible:outline-offset-2"
          >
            <div
              data-theme-swatch={id}
              className={`flex h-12 w-14 flex-col justify-between rounded-[var(--radius-lg)] p-1.5 transition-all ${
                selected === id ? "shadow-popup" : "hover:scale-105"
              }`}
              style={{
                backgroundColor: tk.color.bg.primary,
                border: `1px solid ${tk.color.border}`,
              }}
            >
              <span
                data-swatch-specimen
                className="text-sm font-semibold leading-none"
                style={{ color: tk.color.text.primary }}
              >
                Aa
              </span>
              <span
                aria-hidden="true"
                style={{ display: "block", height: 2, background: tk.color.accent.primary }}
              />
            </div>
            <span
              className={`text-xs ${
                selected === id
                  ? "text-[var(--text-color)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {t(`appearance.theme.${id}`, id)}
            </span>
            {/* In a filtered row the badge would say the same thing under
                every swatch — it earns its place only in the mixed row. */}
            {!mode && (
              <span className="text-xs text-[var(--text-secondary)]">
                {tk.isDark ? t("appearance.theme.badge.dark") : t("appearance.theme.badge.light")}
              </span>
            )}
          </button>
        );
      })}
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
              mode="light"
              selected={appearance.systemLightTheme}
              onSelect={(id) => updateSetting("systemLightTheme", id)}
            />
            <div className="text-xs font-medium text-[var(--text-secondary)] pb-1.5">
              {t("appearance.systemDarkTheme.label")}
            </div>
            <ThemeSwatchRow
              mode="dark"
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
