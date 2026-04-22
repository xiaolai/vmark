/**
 * Editor Settings Section
 *
 * Typography, display, behavior, and whitespace configuration.
 */

import { useTranslation } from "react-i18next";
import {
  useSettingsStore,
  type AppearanceSettings as AppearanceSettingsType,
  type AutoPairCJKStyle,
  type CopyFormat,
} from "@/stores/settingsStore";
import { SettingRow, SettingsGroup, Select, Toggle } from "./components";

/** Font option definitions (labels are not translated — font names are proper nouns) */
const fontOptions = {
  latin: [
    { value: "system", label: null },
    { value: "athelas", label: "Athelas" },
    { value: "palatino", label: "Palatino" },
    { value: "georgia", label: "Georgia" },
    { value: "charter", label: "Charter" },
    { value: "literata", label: "Literata" },
  ],
  cjk: [
    { value: "system", label: null },
    { value: "pingfang", label: "PingFang SC" },
    { value: "songti", label: "Songti SC" },
    { value: "kaiti", label: "Kaiti SC" },
    { value: "notoserif", label: "Noto Serif CJK" },
    { value: "sourcehans", label: "Source Han Sans" },
  ],
  mono: [
    { value: "system", label: null },
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
};

/** Typography settings configuration for data-driven rendering */
type TypographyConfig = {
  labelKey: string;
  key: keyof AppearanceSettingsType;
  options: { value: string; label: string | null }[];
  isNumeric: boolean;
  optionLabelKey?: string;
};

export function EditorSettings() {
  const { t } = useTranslation("settings");
  const appearance = useSettingsStore((state) => state.appearance);
  const general = useSettingsStore((state) => state.general);
  const markdown = useSettingsStore((state) => state.markdown);
  const largeFile = useSettingsStore((state) => state.largeFile);
  const updateAppearanceSetting = useSettingsStore((state) => state.updateAppearanceSetting);
  const updateGeneralSetting = useSettingsStore((state) => state.updateGeneralSetting);
  const updateMarkdownSetting = useSettingsStore((state) => state.updateMarkdownSetting);
  const updateLargeFileSetting = useSettingsStore((state) => state.updateLargeFileSetting);

  // Normalize optional settings
  const autoPairEnabled = markdown.autoPairEnabled ?? true;
  const autoPairCJKStyle = markdown.autoPairCJKStyle ?? "auto";
  const cjkPairingEnabled = autoPairCJKStyle !== "off";
  const curlyQuotesEnabled = markdown.autoPairCurlyQuotes ?? false;

  const systemDefaultLabel = t("editor.font.systemDefault");

  /** Typography settings configuration for data-driven rendering */
  const typographySettings: TypographyConfig[] = [
    { labelKey: "editor.latinFont.label", key: "latinFont", options: fontOptions.latin, isNumeric: false },
    { labelKey: "editor.cjkFont.label", key: "cjkFont", options: fontOptions.cjk, isNumeric: false },
    { labelKey: "editor.monoFont.label", key: "monoFont", options: fontOptions.mono, isNumeric: false },
    { labelKey: "editor.fontSize.label", key: "fontSize", options: numericOptions.fontSize, isNumeric: true },
    {
      labelKey: "editor.lineHeight.label", key: "lineHeight", isNumeric: true,
      options: [
        { value: "1.4", label: t("editor.lineHeight.compact") },
        { value: "1.6", label: t("editor.lineHeight.normal") },
        { value: "1.8", label: t("editor.lineHeight.relaxed") },
        { value: "2.0", label: t("editor.lineHeight.spacious") },
        { value: "2.2", label: t("editor.lineHeight.extra") },
      ],
    },
    {
      labelKey: "editor.blockSpacing.label", key: "blockSpacing", isNumeric: true,
      options: [
        { value: "0.5", label: t("editor.blockSpacing.tight") },
        { value: "1", label: t("editor.blockSpacing.normal") },
        { value: "1.5", label: t("editor.blockSpacing.relaxed") },
        { value: "2", label: t("editor.blockSpacing.spacious") },
      ],
    },
    {
      labelKey: "editor.cjkLetterSpacing.label", key: "cjkLetterSpacing", isNumeric: false,
      options: [
        { value: "0", label: t("editor.cjkLetterSpacing.off") },
        { value: "0.02", label: "0.02em (Subtle)" },
        { value: "0.03", label: "0.03em (Light)" },
        { value: "0.05", label: "0.05em (Normal)" },
        { value: "0.08", label: "0.08em (Wide)" },
        { value: "0.10", label: "0.10em (Wider)" },
        { value: "0.12", label: "0.12em (Extra)" },
      ],
    },
  ];

  const editorWidthOptions = [
    { value: "36", label: t("editor.editorWidth.compact") },
    { value: "42", label: t("editor.editorWidth.narrow") },
    { value: "50", label: t("editor.editorWidth.medium") },
    { value: "60", label: t("editor.editorWidth.wide") },
    { value: "80", label: t("editor.editorWidth.extraWide") },
    { value: "0", label: t("editor.editorWidth.unlimited") },
  ];

  return (
    <div>
      {/* Typography */}
      <SettingsGroup title={t("editor.group.typography")}>
        {typographySettings.map(({ labelKey, key, options, isNumeric }) => (
          <SettingRow key={key} label={t(labelKey)}>
            <Select
              value={String(appearance[key])}
              options={options.map((o) => ({
                value: o.value,
                label: o.label ?? systemDefaultLabel,
              }))}
              onChange={(v) =>
                updateAppearanceSetting(key, isNumeric ? Number(v) : v)
              }
            />
          </SettingRow>
        ))}
      </SettingsGroup>

      {/* Display */}
      <SettingsGroup title={t("editor.group.display")}>
        <SettingRow label={t("editor.editorWidth.label")} description={t("editor.editorWidth.description")}>
          <Select
            value={String(appearance.editorWidth)}
            options={editorWidthOptions}
            onChange={(v) => updateAppearanceSetting("editorWidth", Number(v))}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Behavior */}
      <SettingsGroup title={t("editor.group.behavior")}>
        <SettingRow
          label={t("editor.tabSize.label")}
          description={t("editor.tabSize.description")}
        >
          <Select
            value={String(general.tabSize)}
            options={[
              { value: "2", label: t("editor.tabSize.2spaces") },
              { value: "4", label: t("editor.tabSize.4spaces") },
            ]}
            onChange={(v) => updateGeneralSetting("tabSize", Number(v))}
          />
        </SettingRow>
        <SettingRow
          label={t("editor.autoPair.label")}
          description={t("editor.autoPair.description")}
        >
          <Toggle
            checked={autoPairEnabled}
            onChange={(v) => updateMarkdownSetting("autoPairEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("editor.cjkBrackets.label")}
          description={t("editor.cjkBrackets.description")}
          disabled={!autoPairEnabled}
        >
          <Select<AutoPairCJKStyle>
            value={autoPairCJKStyle}
            options={[
              { value: "off", label: t("editor.cjkBrackets.off") },
              { value: "auto", label: t("editor.cjkBrackets.auto") },
            ]}
            onChange={(v) => updateMarkdownSetting("autoPairCJKStyle", v)}
            disabled={!autoPairEnabled}
          />
        </SettingRow>
        {cjkPairingEnabled && (
          <SettingRow
            label={t("editor.curlyQuotes.label")}
            description={t("editor.curlyQuotes.description")}
            disabled={!autoPairEnabled}
          >
            <Toggle
              checked={curlyQuotesEnabled}
              onChange={(v) => updateMarkdownSetting("autoPairCurlyQuotes", v)}
              disabled={!autoPairEnabled}
            />
          </SettingRow>
        )}
        {cjkPairingEnabled && curlyQuotesEnabled && (
          <SettingRow
            label={t("editor.rightDoubleQuote.label")}
            description={t("editor.rightDoubleQuote.description")}
            disabled={!autoPairEnabled}
          >
            <Toggle
              checked={markdown.autoPairRightDoubleQuote ?? false}
              onChange={(v) => updateMarkdownSetting("autoPairRightDoubleQuote", v)}
              disabled={!autoPairEnabled}
            />
          </SettingRow>
        )}
        <SettingRow
          label={t("editor.copyFormat.label")}
          description={t("editor.copyFormat.description")}
        >
          <Select<CopyFormat>
            value={markdown.copyFormat}
            options={[
              { value: "default", label: t("editor.copyFormat.plainText") },
              { value: "markdown", label: t("editor.copyFormat.markdown") },
            ]}
            onChange={(v) => updateMarkdownSetting("copyFormat", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("editor.copyOnSelect.label")}
          description={t("editor.copyOnSelect.description")}
        >
          <Toggle
            checked={markdown.copyOnSelect}
            onChange={(v) => updateMarkdownSetting("copyOnSelect", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Whitespace */}
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
      </SettingsGroup>

      {/* Large files */}
      <SettingsGroup title={t("editor.group.largeFiles")}>
        <SettingRow
          label={t("editor.largeFile.autoSourceMode.label")}
          description={t("editor.largeFile.autoSourceMode.description")}
        >
          <Toggle
            checked={largeFile.autoSourceMode}
            onChange={(v) => updateLargeFileSetting("autoSourceMode", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("editor.largeFile.warnAbove5MB.label")}
          description={t("editor.largeFile.warnAbove5MB.description")}
        >
          <Toggle
            checked={largeFile.warnAbove5MB}
            onChange={(v) => updateLargeFileSetting("warnAbove5MB", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
