/**
 * FontSettings — the three font-role rows of the Typography group.
 *
 * Split out of `EditorSettings.tsx`, which sat exactly on the ~300-line file
 * limit, when the curated tables gained the installed-font picker (#1429).
 *
 * The curated tables themselves live in `utils/fontOptions` — the PDF export
 * sidebar renders the same list, and the two hand-written copies it replaced
 * had already drifted apart.
 *
 * @coordinates-with FontSettingRow.tsx — one row each
 * @coordinates-with utils/fontOptions.ts — the curated shortlists
 * @module pages/settings/FontSettings
 */
import { useTranslation } from "react-i18next";
import { useSettingsStore, type AppearanceSettings } from "@/stores/settingsStore";
import { useSystemFontFamilies } from "@/hooks/useSystemFontFamilies";
import type { FontOption } from "@/utils/fontOptions";
import { FONT_OPTIONS } from "@/utils/fontOptions";
import { FontSettingRow } from "./FontSettingRow";

/** One row per font role, in the order the reader meets them. */
const FONT_ROLES: { labelKey: string; key: keyof AppearanceSettings; options: readonly FontOption[] }[] = [
  { labelKey: "editor.latinFont.label", key: "latinFont", options: FONT_OPTIONS.latin },
  { labelKey: "editor.cjkFont.label", key: "cjkFont", options: FONT_OPTIONS.cjk },
  { labelKey: "editor.monoFont.label", key: "monoFont", options: FONT_OPTIONS.mono },
];

/** The Latin / CJK / Mono pickers, each with the installed families appended. */
export function FontSettings() {
  const { t } = useTranslation("settings");
  const appearance = useSettingsStore((state) => state.appearance);
  const updateAppearanceSetting = useSettingsStore((state) => state.updateAppearanceSetting);
  const installed = useSystemFontFamilies();
  const systemDefaultLabel = t("editor.font.systemDefault");

  return (
    <>
      {FONT_ROLES.map(({ labelKey, key, options }) => (
        <FontSettingRow
          key={key}
          label={t(labelKey)}
          value={String(appearance[key])}
          options={options}
          systemDefaultLabel={systemDefaultLabel}
          installed={installed}
          onChange={(v) => updateAppearanceSetting(key, v)}
        />
      ))}
    </>
  );
}
