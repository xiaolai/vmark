import { useSettingsStore, type MediaBorderStyle } from "@/stores/settingsStore";
import { SettingRow, Toggle, SettingsGroup, Select } from "./components";

export function MarkdownSettings() {
  const markdown = useSettingsStore((state) => state.markdown);
  const updateSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        Markdown
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Configure whitespace and line break behavior for markdown editing.
      </p>

      <SettingsGroup title="Editing">
        <SettingRow
          label="Reveal inline syntax"
          description="Show markdown markers (**, *, `) when cursor is in formatted text"
        >
          <Toggle
            checked={markdown.revealInlineSyntax}
            onChange={(v) => updateSetting("revealInlineSyntax", v)}
          />
        </SettingRow>
        <SettingRow
          label="Enable regex in search"
          description="Show regex toggle button in Find & Replace bar"
        >
          <Toggle
            checked={markdown.enableRegexSearch}
            onChange={(v) => updateSetting("enableRegexSearch", v)}
          />
        </SettingRow>
      </SettingsGroup>

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

      <SettingsGroup title="Whitespace & Line Breaks" className="">
        <SettingRow
          label="Preserve consecutive line breaks"
          description="Keep multiple blank lines as-is (don't collapse)"
        >
          <Toggle
            checked={markdown.preserveLineBreaks}
            onChange={(v) => updateSetting("preserveLineBreaks", v)}
          />
        </SettingRow>
        <SettingRow
          label="Show <br> tags"
          description="Display HTML line break tags visibly in editor"
        >
          <Toggle
            checked={markdown.showBrTags}
            onChange={(v) => updateSetting("showBrTags", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
