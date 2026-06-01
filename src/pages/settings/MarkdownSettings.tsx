/**
 * Markdown Settings Section
 *
 * Paste & input, layout, and HTML rendering configuration.
 */

import { useTranslation } from "react-i18next";
import {
  useSettingsStore,
  type MediaBorderStyle,
  type MediaAlignment,
  type HeadingAlignment,
  type BlockFontSize,
  type HtmlRenderingMode,
  type MarkdownPasteMode,
  type PasteMode,
} from "@/stores/settingsStore";
import { SettingRow, Toggle, SettingsGroup, Select } from "./components";

export function MarkdownSettings() {
  const { t } = useTranslation("settings");
  const markdown = useSettingsStore((state) => state.markdown);
  const updateSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  return (
    <div>
      {/* Paste & Input */}
      <SettingsGroup title={t("markdown.group.pasteInput")}>
        <SettingRow
          label={t("markdown.enableRegexSearch.label")}
          description={t("markdown.enableRegexSearch.description")}
        >
          <Toggle
            checked={markdown.enableRegexSearch}
            onChange={(v) => updateSetting("enableRegexSearch", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.smartPaste.label")}
          description={t("markdown.smartPaste.description")}
        >
          <Select<MarkdownPasteMode>
            value={markdown.pasteMarkdownInWysiwyg}
            options={[
              { value: "auto", label: t("markdown.smartPaste.auto") },
              { value: "off", label: t("markdown.smartPaste.off") },
            ]}
            onChange={(v) => updateSetting("pasteMarkdownInWysiwyg", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.pasteMode.label")}
          description={t("markdown.pasteMode.description")}
        >
          <Select<PasteMode>
            value={markdown.pasteMode}
            options={[
              { value: "smart", label: t("markdown.pasteMode.smart") },
              { value: "plain", label: t("markdown.pasteMode.plain") },
              { value: "rich", label: t("markdown.pasteMode.rich") },
            ]}
            onChange={(v) => updateSetting("pasteMode", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Layout */}
      <SettingsGroup title={t("markdown.group.layout")}>
        <SettingRow
          label={t("markdown.blockFontSize.label")}
          description={t("markdown.blockFontSize.description")}
        >
          <Select<BlockFontSize>
            value={markdown.blockFontSize}
            options={[
              { value: "1", label: t("markdown.blockFontSize.100") },
              { value: "0.95", label: t("markdown.blockFontSize.95") },
              { value: "0.9", label: t("markdown.blockFontSize.90") },
              { value: "0.85", label: t("markdown.blockFontSize.85") },
            ]}
            onChange={(v) => updateSetting("blockFontSize", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.headingAlignment.label")}
          description={t("markdown.headingAlignment.description")}
        >
          <Select<HeadingAlignment>
            value={markdown.headingAlignment}
            options={[
              { value: "left", label: t("markdown.headingAlignment.left") },
              { value: "center", label: t("markdown.headingAlignment.center") },
            ]}
            onChange={(v) => updateSetting("headingAlignment", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.mediaBorder.label")}
          description={t("markdown.mediaBorder.description")}
        >
          <Select<MediaBorderStyle>
            value={markdown.mediaBorderStyle}
            options={[
              { value: "none", label: t("markdown.mediaBorder.none") },
              { value: "always", label: t("markdown.mediaBorder.always") },
              { value: "hover", label: t("markdown.mediaBorder.hover") },
            ]}
            onChange={(v) => updateSetting("mediaBorderStyle", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.mediaAlignment.label")}
          description={t("markdown.mediaAlignment.description")}
        >
          <Select<MediaAlignment>
            value={markdown.mediaAlignment}
            options={[
              { value: "center", label: t("markdown.mediaAlignment.center") },
              { value: "left", label: t("markdown.mediaAlignment.left") },
            ]}
            onChange={(v) => updateSetting("mediaAlignment", v)}
          />
        </SettingRow>
        <SettingRow
          label={t("markdown.tableFitToWidth.label")}
          description={t("markdown.tableFitToWidth.description")}
        >
          <Toggle
            checked={markdown.tableFitToWidth}
            onChange={(v) => updateSetting("tableFitToWidth", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* HTML Rendering */}
      <SettingsGroup title={t("markdown.group.htmlRendering")}>
        <SettingRow
          label={t("markdown.htmlRendering.label")}
          description={t("markdown.htmlRendering.description")}
        >
          <Select<HtmlRenderingMode>
            value={markdown.htmlRenderingMode}
            options={[
              { value: "hidden", label: t("markdown.htmlRendering.hidden") },
              { value: "sanitized", label: t("markdown.htmlRendering.sanitized") },
              { value: "sanitizedWithStyles", label: t("markdown.htmlRendering.sanitizedWithStyles") },
            ]}
            onChange={(v) => updateSetting("htmlRenderingMode", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Markdown Lint */}
      <SettingsGroup title={t("markdown.group.lint")}>
        <SettingRow
          label={t("markdown.lintEnabled.label")}
          description={t("markdown.lintEnabled.description")}
        >
          <Toggle
            checked={markdown.lintEnabled}
            onChange={(v) => updateSetting("lintEnabled", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
