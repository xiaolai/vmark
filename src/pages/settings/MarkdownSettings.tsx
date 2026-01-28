/**
 * Markdown Settings Section
 *
 * Paste & input, layout, and HTML rendering configuration.
 */

import {
  useSettingsStore,
  type MediaBorderStyle,
  type MediaAlignment,
  type HeadingAlignment,
  type BlockFontSize,
  type HtmlRenderingMode,
  type MarkdownPasteMode,
} from "@/stores/settingsStore";
import { SettingRow, Toggle, SettingsGroup, Select } from "./components";

export function MarkdownSettings() {
  const markdown = useSettingsStore((state) => state.markdown);
  const updateSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  return (
    <div>
      {/* Paste & Input */}
      <SettingsGroup title="Paste & Input">
        <SettingRow
          label="Enable regex in search"
          description="Show regex toggle button in Find & Replace bar"
        >
          <Toggle
            checked={markdown.enableRegexSearch}
            onChange={(v) => updateSetting("enableRegexSearch", v)}
          />
        </SettingRow>
        <SettingRow
          label="Smart paste Markdown"
          description="Convert pasted Markdown text into rich content in WYSIWYG"
        >
          <Select<MarkdownPasteMode>
            value={markdown.pasteMarkdownInWysiwyg}
            options={[
              { value: "auto", label: "Auto (detect Markdown)" },
              { value: "off", label: "Off" },
            ]}
            onChange={(v) => updateSetting("pasteMarkdownInWysiwyg", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* Layout */}
      <SettingsGroup title="Layout">
        <SettingRow
          label="Block element font size"
          description="Font size for lists, blockquotes, tables, alerts, and details"
        >
          <Select<BlockFontSize>
            value={markdown.blockFontSize}
            options={[
              { value: "1", label: "100% (default)" },
              { value: "0.95", label: "95%" },
              { value: "0.9", label: "90%" },
              { value: "0.85", label: "85%" },
            ]}
            onChange={(v) => updateSetting("blockFontSize", v)}
          />
        </SettingRow>
        <SettingRow
          label="Heading alignment"
          description="Text alignment for headings"
        >
          <Select<HeadingAlignment>
            value={markdown.headingAlignment}
            options={[
              { value: "left", label: "Left" },
              { value: "center", label: "Center" },
            ]}
            onChange={(v) => updateSetting("headingAlignment", v)}
          />
        </SettingRow>
        <SettingRow
          label="Image & diagram borders"
          description="Show borders around images, Mermaid diagrams, and math blocks"
        >
          <Select<MediaBorderStyle>
            value={markdown.mediaBorderStyle}
            options={[
              { value: "none", label: "None" },
              { value: "always", label: "Always" },
              { value: "hover", label: "On hover" },
            ]}
            onChange={(v) => updateSetting("mediaBorderStyle", v)}
          />
        </SettingRow>
        <SettingRow
          label="Image & table alignment"
          description="Horizontal alignment for block images and tables"
        >
          <Select<MediaAlignment>
            value={markdown.mediaAlignment}
            options={[
              { value: "center", label: "Center" },
              { value: "left", label: "Left" },
            ]}
            onChange={(v) => updateSetting("mediaAlignment", v)}
          />
        </SettingRow>
      </SettingsGroup>

      {/* HTML Rendering */}
      <SettingsGroup title="HTML Rendering">
        <SettingRow
          label="Raw HTML in rich text"
          description="Control whether raw HTML is hidden or rendered (sanitized)"
        >
          <Select<HtmlRenderingMode>
            value={markdown.htmlRenderingMode}
            options={[
              { value: "hidden", label: "Hidden" },
              { value: "sanitized", label: "Sanitized" },
              { value: "sanitizedWithStyles", label: "Sanitized + styles" },
            ]}
            onChange={(v) => updateSetting("htmlRenderingMode", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
