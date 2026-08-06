/**
 * Whitespace settings group — line endings, line/blank-line preservation, hard
 * breaks, and invisibles. Extracted from EditorSettings.tsx (self-contained,
 * reads the store via selectors per the VMark convention).
 *
 * @module pages/settings/WhitespaceSettings
 */
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";

export function WhitespaceSettings() {
  const { t } = useTranslation("settings");
  const general = useSettingsStore((state) => state.general);
  const markdown = useSettingsStore((state) => state.markdown);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);
  const updateMarkdownSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  return (
    <SettingsGroup title={t("editor.group.whitespace")}>
      <SettingRow
        label={t("editor.lineEndings.label")}
        description={t("editor.lineEndings.description")}
      >
        <Select
          value={general.lineEndingsOnSave}
          options={[
            { value: "preserve", label: t("editor.lineEndings.preserve") },
            { value: "lf", label: t("editor.lineEndings.lf") },
            { value: "crlf", label: t("editor.lineEndings.crlf") },
          ]}
          onChange={(v) => updateGeneralSetting("lineEndingsOnSave", v as typeof general.lineEndingsOnSave)}
        />
      </SettingRow>
      <SettingRow
        label={t("editor.preserveLineBreaks.label")}
        description={t("editor.preserveLineBreaks.description")}
      >
        <Toggle
          checked={markdown.preserveLineBreaks}
          onChange={(v) => updateMarkdownSetting("preserveLineBreaks", v)}
        />
      </SettingRow>
      <SettingRow
        label={t("editor.preserveBlankLines.label")}
        description={t("editor.preserveBlankLines.description")}
      >
        <Toggle
          checked={markdown.preserveBlankLines}
          onChange={(v) => updateMarkdownSetting("preserveBlankLines", v)}
        />
      </SettingRow>
      <SettingRow
        label={t("editor.hardBreakStyle.label")}
        description={t("editor.hardBreakStyle.description")}
      >
        <Select
          value={markdown.hardBreakStyleOnSave}
          options={[
            { value: "twoSpaces", label: t("editor.hardBreakStyle.twoSpaces") },
            { value: "preserve", label: t("editor.hardBreakStyle.preserve") },
            { value: "backslash", label: t("editor.hardBreakStyle.backslash") },
          ]}
          onChange={(v) => updateMarkdownSetting("hardBreakStyleOnSave", v as typeof markdown.hardBreakStyleOnSave)}
        />
      </SettingRow>
      <SettingRow
        label={t("editor.showBrTags.label")}
        description={t("editor.showBrTags.description")}
      >
        <Toggle
          checked={markdown.showBrTags}
          onChange={(v) => updateMarkdownSetting("showBrTags", v)}
        />
      </SettingRow>
      <SettingRow
        label={t("editor.showInvisibles.label")}
        description={t("editor.showInvisibles.description")}
      >
        <Toggle
          checked={markdown.showInvisibles}
          onChange={(v) => updateMarkdownSetting("showInvisibles", v)}
        />
      </SettingRow>
    </SettingsGroup>
  );
}
