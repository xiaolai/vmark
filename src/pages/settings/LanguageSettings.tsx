/**
 * Language Settings Section
 *
 * Spell check and CJK formatting configuration.
 */

import { useSettingsStore, type SpellCheckLanguage, type QuoteStyle } from "@/stores/settingsStore";
import { SettingRow, Toggle, SettingsGroup, Select } from "./components";

const spellCheckLanguageOptions: { value: SpellCheckLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "German" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "ko", label: "Korean" },
];

export function LanguageSettings() {
  const markdown = useSettingsStore((state) => state.markdown);
  const cjkFormatting = useSettingsStore((state) => state.cjkFormatting);
  const updateMarkdownSetting = useSettingsStore((state) => state.updateMarkdownSetting);
  const updateCJKSetting = useSettingsStore((state) => state.updateCJKFormattingSetting);

  const selectClass = `px-2 py-1 rounded border border-[var(--border-color)]
                       bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]`;

  return (
    <div>
      {/* Spell Check */}
      <SettingsGroup title="Spell Check">
        <SettingRow
          label="Enable spell check"
          description="Underline misspelled words"
        >
          <Toggle
            checked={markdown.spellCheckEnabled}
            onChange={(v) => updateMarkdownSetting("spellCheckEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="Language"
          description="Primary language for spell checking"
          disabled={!markdown.spellCheckEnabled}
        >
          <Select<SpellCheckLanguage>
            value={markdown.spellCheckLanguages[0] ?? "en"}
            options={spellCheckLanguageOptions}
            onChange={(v) => updateMarkdownSetting("spellCheckLanguages", [v])}
            disabled={!markdown.spellCheckEnabled}
          />
        </SettingRow>
      </SettingsGroup>

      {/* CJK Formatting */}
      <SettingsGroup title="CJK Formatting">
        <p className="text-xs text-[var(--text-tertiary)] -mt-2 mb-3">
          Formatting rules for CJK (Chinese, Japanese, Korean) text. Use Format &gt; Format CJK Text (Cmd+Shift+F) to apply.
        </p>
        {/* Fullwidth Normalization */}
        <SettingsGroup title="Fullwidth Normalization">
          <SettingRow
            label="Convert fullwidth letters/numbers"
            description="1 2 3 -> 123, A -> A"
          >
            <Toggle
              checked={cjkFormatting.fullwidthAlphanumeric}
              onChange={(v) => updateCJKSetting("fullwidthAlphanumeric", v)}
            />
          </SettingRow>
          <SettingRow
            label="Normalize punctuation width"
            description=", -> , when between CJK"
          >
            <Toggle
              checked={cjkFormatting.fullwidthPunctuation}
              onChange={(v) => updateCJKSetting("fullwidthPunctuation", v)}
            />
          </SettingRow>
          <SettingRow
            label="Convert parentheses"
            description="() -> () when content is CJK"
          >
            <Toggle
              checked={cjkFormatting.fullwidthParentheses}
              onChange={(v) => updateCJKSetting("fullwidthParentheses", v)}
            />
          </SettingRow>
          <SettingRow
            label="Convert brackets"
            description="[] -> 【】 when content is CJK"
          >
            <Toggle
              checked={cjkFormatting.fullwidthBrackets}
              onChange={(v) => updateCJKSetting("fullwidthBrackets", v)}
            />
          </SettingRow>
        </SettingsGroup>

        {/* Spacing */}
        <SettingsGroup title="Spacing">
          <SettingRow
            label="Add CJK-English spacing"
            description="Chinese English -> Chinese English"
          >
            <Toggle
              checked={cjkFormatting.cjkEnglishSpacing}
              onChange={(v) => updateCJKSetting("cjkEnglishSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Add CJK-parenthesis spacing"
            description="Test (test) -> Test (test)"
          >
            <Toggle
              checked={cjkFormatting.cjkParenthesisSpacing}
              onChange={(v) => updateCJKSetting("cjkParenthesisSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Remove currency spacing"
            description="$ 100 -> $100"
          >
            <Toggle
              checked={cjkFormatting.currencySpacing}
              onChange={(v) => updateCJKSetting("currencySpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Remove slash spacing"
            description="A / B -> A/B (preserves URLs)"
          >
            <Toggle
              checked={cjkFormatting.slashSpacing}
              onChange={(v) => updateCJKSetting("slashSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Collapse multiple spaces"
            description="Multiple spaces -> single space"
          >
            <Toggle
              checked={cjkFormatting.spaceCollapsing}
              onChange={(v) => updateCJKSetting("spaceCollapsing", v)}
            />
          </SettingRow>
        </SettingsGroup>

        {/* Dash & Quotes */}
        <SettingsGroup title="Dash & Quotes">
          <SettingRow label="Convert dashes" description="-- → —— between CJK">
            <Toggle
              checked={cjkFormatting.dashConversion}
              onChange={(v) => updateCJKSetting("dashConversion", v)}
            />
          </SettingRow>
          <SettingRow
            label="Fix em-dash spacing"
            description="Proper spacing around ——"
          >
            <Toggle
              checked={cjkFormatting.emdashSpacing}
              onChange={(v) => updateCJKSetting("emdashSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Convert straight quotes"
            description={'Convert " and \' to smart quotes'}
          >
            <Toggle
              checked={cjkFormatting.smartQuoteConversion}
              onChange={(v) => updateCJKSetting("smartQuoteConversion", v)}
            />
          </SettingRow>
          <SettingRow
            label="Quote style"
            description="Target style for quote conversion"
            disabled={!cjkFormatting.smartQuoteConversion}
          >
            <Select<QuoteStyle>
              value={cjkFormatting.quoteStyle}
              options={[
                { value: "curly", label: 'Curly "" \u2018\u2019' },
                { value: "corner", label: "Corner 「」『』" },
                { value: "guillemets", label: "Guillemets «» ‹›" },
              ]}
              onChange={(v) => updateCJKSetting("quoteStyle", v)}
              disabled={!cjkFormatting.smartQuoteConversion}
            />
          </SettingRow>
          <SettingRow
            label="Fix double quote spacing"
            description={'Spacing around ""'}
          >
            <Toggle
              checked={cjkFormatting.quoteSpacing}
              onChange={(v) => updateCJKSetting("quoteSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="Fix single quote spacing"
            description={"Spacing around ''"}
          >
            <Toggle
              checked={cjkFormatting.singleQuoteSpacing}
              onChange={(v) => updateCJKSetting("singleQuoteSpacing", v)}
            />
          </SettingRow>
          <SettingRow
            label="CJK corner quotes"
            description={'"Chinese" → 「Chinese」 (Traditional Chinese/Japanese)'}
            disabled={cjkFormatting.quoteStyle !== "curly"}
          >
            <Toggle
              checked={cjkFormatting.cjkCornerQuotes}
              onChange={(v) => updateCJKSetting("cjkCornerQuotes", v)}
              disabled={cjkFormatting.quoteStyle !== "curly"}
            />
          </SettingRow>
          <SettingRow
            label="Nested corner quotes"
            description={"Nested '' → 『』 inside 「」"}
          >
            <Toggle
              checked={cjkFormatting.cjkNestedQuotes}
              onChange={(v) => updateCJKSetting("cjkNestedQuotes", v)}
            />
          </SettingRow>
        </SettingsGroup>

        {/* Cleanup */}
        <SettingsGroup title="Cleanup" className="">
          <SettingRow
            label="Limit consecutive punctuation"
            description="Limit repeated !?."
          >
            <select
              value={cjkFormatting.consecutivePunctuationLimit}
              onChange={(e) =>
                updateCJKSetting(
                  "consecutivePunctuationLimit",
                  Number(e.target.value)
                )
              }
              className={selectClass}
            >
              <option value="0">Off</option>
              <option value="1">Single (!! → !)</option>
              <option value="2">Double (!!! → !!)</option>
            </select>
          </SettingRow>
          <SettingRow
            label="Remove trailing spaces"
            description="Remove spaces at end of lines"
          >
            <Toggle
              checked={cjkFormatting.trailingSpaceRemoval}
              onChange={(v) => updateCJKSetting("trailingSpaceRemoval", v)}
            />
          </SettingRow>
          <SettingRow label="Normalize ellipsis" description=". . . -> ...">
            <Toggle
              checked={cjkFormatting.ellipsisNormalization}
              onChange={(v) => updateCJKSetting("ellipsisNormalization", v)}
            />
          </SettingRow>
          <SettingRow label="Collapse newlines" description="3+ newlines -> 2">
            <Toggle
              checked={cjkFormatting.newlineCollapsing}
              onChange={(v) => updateCJKSetting("newlineCollapsing", v)}
            />
          </SettingRow>
        </SettingsGroup>
      </SettingsGroup>
    </div>
  );
}
