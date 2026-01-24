/**
 * Markdown Settings Section
 *
 * Paste & input, media display, and HTML rendering configuration.
 */

import {
  useSettingsStore,
  type MediaBorderStyle,
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

      {/* Media Display */}
      <SettingsGroup title="Media Display">
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
