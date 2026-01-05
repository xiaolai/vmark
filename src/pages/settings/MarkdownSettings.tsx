import { useSettingsStore, type MediaBorderStyle, type AutoPairCJKStyle } from "@/stores/settingsStore";
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
          label="Edit syntax markers"
          description="Allow editing markdown markers with Backspace/Delete (** → *)"
          disabled={!markdown.revealInlineSyntax}
        >
          <Toggle
            checked={markdown.allowEditMarkers ?? false}
            onChange={(v) => updateSetting("allowEditMarkers", v)}
            disabled={!markdown.revealInlineSyntax}
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

      <SettingsGroup title="Auto-Pairing">
        <SettingRow
          label="Enable auto-pairing"
          description="Automatically insert closing brackets and quotes"
        >
          <Toggle
            checked={markdown.autoPairEnabled ?? true}
            onChange={(v) => updateSetting("autoPairEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="CJK brackets"
          description="Auto-pair CJK brackets like 「」【】《》"
          disabled={!markdown.autoPairEnabled}
        >
          <Select<AutoPairCJKStyle>
            value={markdown.autoPairCJKStyle ?? "auto"}
            options={[
              { value: "off", label: "Off" },
              { value: "auto", label: "Auto" },
            ]}
            onChange={(v) => updateSetting("autoPairCJKStyle", v)}
            disabled={!markdown.autoPairEnabled}
          />
        </SettingRow>
        {markdown.autoPairCJKStyle !== "off" && (
          <SettingRow
            label="Include curly quotes"
            description={`Auto-pair \u201C\u201D and \u2018\u2019 (may conflict with IME smart quotes)`}
            disabled={!markdown.autoPairEnabled}
          >
            <Toggle
              checked={markdown.autoPairCurlyQuotes ?? false}
              onChange={(v) => updateSetting("autoPairCurlyQuotes", v)}
              disabled={!markdown.autoPairEnabled}
            />
          </SettingRow>
        )}
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
