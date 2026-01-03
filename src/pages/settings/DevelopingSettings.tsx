import { useSettingsStore, type SpellCheckLanguage } from "@/stores/settingsStore";
import { useSpellCheckStore } from "@/stores/spellCheckStore";
import { SettingRow, Toggle, SettingsGroup } from "./components";

const SPELL_CHECK_LANGUAGES: { value: SpellCheckLanguage; label: string }[] = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Espanol" },
  { value: "fr", label: "Francais" },
  { value: "ko", label: "한국어" },
];

function LanguageCheckboxes({
  selected,
  onChange,
}: {
  selected: SpellCheckLanguage[];
  onChange: (languages: SpellCheckLanguage[]) => void;
}) {
  const toggleLanguage = (lang: SpellCheckLanguage) => {
    if (selected.includes(lang)) {
      if (selected.length > 1) {
        onChange(selected.filter((l) => l !== lang));
      }
    } else {
      onChange([...selected, lang]);
    }
  };

  return (
    <div className="flex gap-3 flex-wrap">
      {SPELL_CHECK_LANGUAGES.map((lang) => (
        <label
          key={lang.value}
          className="flex items-center gap-1.5 text-sm text-[var(--text-primary)] cursor-pointer"
        >
          <input
            type="checkbox"
            checked={selected.includes(lang.value)}
            onChange={() => toggleLanguage(lang.value)}
            className="w-3.5 h-3.5 rounded border-gray-300 text-[var(--accent-primary)]
                       focus:ring-[var(--accent-primary)] focus:ring-offset-0"
          />
          {lang.label}
        </label>
      ))}
    </div>
  );
}

function PersonalDictionary() {
  const ignoredWords = useSpellCheckStore((state) => state.ignoredWords);
  const removeFromIgnored = useSpellCheckStore((state) => state.removeFromIgnored);
  const clearIgnored = useSpellCheckStore((state) => state.clearIgnored);

  if (ignoredWords.length === 0) {
    return (
      <div className="text-xs text-[var(--text-tertiary)] py-2">
        No words added yet. Right-click on a misspelled word and select "Add to Dictionary".
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ignoredWords.map((word) => (
          <span
            key={word}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md
                       bg-[var(--bg-secondary)] text-sm text-[var(--text-primary)]"
          >
            {word}
            <button
              onClick={() => removeFromIgnored(word)}
              className="ml-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                         transition-colors"
              aria-label={`Remove "${word}" from dictionary`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708z"/>
              </svg>
            </button>
          </span>
        ))}
      </div>
      <button
        onClick={clearIgnored}
        className="text-xs text-[var(--text-tertiary)] hover:text-[var(--accent-primary)]
                   transition-colors"
      >
        Clear all ({ignoredWords.length} words)
      </button>
    </div>
  );
}

export function DevelopingSettings() {
  const markdown = useSettingsStore((state) => state.markdown);
  const updateSetting = useSettingsStore((state) => state.updateMarkdownSetting);

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        Developing
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Experimental features under development. Press ⌃⌥⌘D to toggle this section.
      </p>

      <SettingsGroup title="Spell Check">
        <SettingRow
          label="Enable spell check"
          description="Underline misspelled words with red wavy line"
        >
          <Toggle
            checked={markdown.spellCheckEnabled ?? false}
            onChange={(v) => updateSetting("spellCheckEnabled", v)}
          />
        </SettingRow>
        <SettingRow
          label="Languages"
          description="Check spelling in selected languages"
        >
          <LanguageCheckboxes
            selected={markdown.spellCheckLanguages ?? ["en"]}
            onChange={(v) => updateSetting("spellCheckLanguages", v)}
          />
        </SettingRow>
        <div className="py-3 border-b border-gray-200 dark:border-gray-700">
          <div className="text-sm font-medium text-[var(--text-primary)] mb-2">
            Personal Dictionary
          </div>
          <div className="text-xs text-[var(--text-tertiary)] mb-3">
            Words you've added will be ignored by spell check
          </div>
          <PersonalDictionary />
        </div>
      </SettingsGroup>
    </div>
  );
}
