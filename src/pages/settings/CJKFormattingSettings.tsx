import { useSettingsStore } from "@/stores/settingsStore";

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700">
      <div className="flex-1">
        <div className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </div>
        {description && (
          <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="ml-4">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-7 h-4 rounded-full transition-colors
                  ${checked ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-tertiary)]"}`}
    >
      <span
        className={`absolute top-[3px] left-[3px] w-2.5 h-2.5 rounded-full bg-white shadow
                    transition-transform ${checked ? "translate-x-3" : ""}`}
      />
    </button>
  );
}

function SettingsGroup({
  title,
  children,
  className = "mb-6",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      <div className="text-sm font-medium text-[var(--text-primary)] mb-3">
        {title}
      </div>
      <div className={`space-y-1 ${className}`}>{children}</div>
    </>
  );
}

export function CJKFormattingSettings() {
  const cjkFormatting = useSettingsStore((state) => state.cjkFormatting);
  const updateSetting = useSettingsStore(
    (state) => state.updateCJKFormattingSetting
  );

  const selectClass = `px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                       bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]`;

  return (
    <div>
      <h2 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
        CJK Formatting
      </h2>
      <p className="text-xs text-[var(--text-tertiary)] mb-4">
        Configure formatting rules for CJK (Chinese, Japanese, Korean) text.
        Use Format → Format CJK Text (⌘⇧F) to apply.
      </p>

      <SettingsGroup title="Fullwidth Normalization">
        <SettingRow
          label="Convert fullwidth letters/numbers"
          description="１２３ → 123, Ａ → A"
        >
          <Toggle
            checked={cjkFormatting.fullwidthAlphanumeric}
            onChange={(v) => updateSetting("fullwidthAlphanumeric", v)}
          />
        </SettingRow>
        <SettingRow
          label="Normalize punctuation width"
          description=", → ，when between CJK"
        >
          <Toggle
            checked={cjkFormatting.fullwidthPunctuation}
            onChange={(v) => updateSetting("fullwidthPunctuation", v)}
          />
        </SettingRow>
        <SettingRow
          label="Convert parentheses"
          description="() → （）when content is CJK"
        >
          <Toggle
            checked={cjkFormatting.fullwidthParentheses}
            onChange={(v) => updateSetting("fullwidthParentheses", v)}
          />
        </SettingRow>
        <SettingRow
          label="Convert brackets"
          description="[] → 【】when content is CJK"
        >
          <Toggle
            checked={cjkFormatting.fullwidthBrackets}
            onChange={(v) => updateSetting("fullwidthBrackets", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Spacing">
        <SettingRow
          label="Add CJK-English spacing"
          description="中文English → 中文 English"
        >
          <Toggle
            checked={cjkFormatting.cjkEnglishSpacing}
            onChange={(v) => updateSetting("cjkEnglishSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Add CJK-parenthesis spacing"
          description="测试(test) → 测试 (test)"
        >
          <Toggle
            checked={cjkFormatting.cjkParenthesisSpacing}
            onChange={(v) => updateSetting("cjkParenthesisSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Remove currency spacing"
          description="$ 100 → $100"
        >
          <Toggle
            checked={cjkFormatting.currencySpacing}
            onChange={(v) => updateSetting("currencySpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Remove slash spacing"
          description="A / B → A/B (preserves URLs)"
        >
          <Toggle
            checked={cjkFormatting.slashSpacing}
            onChange={(v) => updateSetting("slashSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Collapse multiple spaces"
          description="Multiple spaces → single space"
        >
          <Toggle
            checked={cjkFormatting.spaceCollapsing}
            onChange={(v) => updateSetting("spaceCollapsing", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Dash & Quotes">
        <SettingRow label="Convert dashes" description="-- → —— between CJK">
          <Toggle
            checked={cjkFormatting.dashConversion}
            onChange={(v) => updateSetting("dashConversion", v)}
          />
        </SettingRow>
        <SettingRow
          label="Fix em-dash spacing"
          description="Proper spacing around ——"
        >
          <Toggle
            checked={cjkFormatting.emdashSpacing}
            onChange={(v) => updateSetting("emdashSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Fix double quote spacing"
          description={'Spacing around ""'}
        >
          <Toggle
            checked={cjkFormatting.quoteSpacing}
            onChange={(v) => updateSetting("quoteSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Fix single quote spacing"
          description={"Spacing around ''"}
        >
          <Toggle
            checked={cjkFormatting.singleQuoteSpacing}
            onChange={(v) => updateSetting("singleQuoteSpacing", v)}
          />
        </SettingRow>
        <SettingRow
          label="Use CJK corner quotes"
          description={'"中文" → 「中文」'}
        >
          <Toggle
            checked={cjkFormatting.cjkCornerQuotes}
            onChange={(v) => updateSetting("cjkCornerQuotes", v)}
          />
        </SettingRow>
        <SettingRow
          label="Use nested corner quotes"
          description={"Nested '' → 『』inside 「」"}
        >
          <Toggle
            checked={cjkFormatting.cjkNestedQuotes}
            onChange={(v) => updateSetting("cjkNestedQuotes", v)}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup title="Cleanup" className="">
        <SettingRow
          label="Limit consecutive punctuation"
          description="Limit repeated ！？。"
        >
          <select
            value={cjkFormatting.consecutivePunctuationLimit}
            onChange={(e) =>
              updateSetting(
                "consecutivePunctuationLimit",
                Number(e.target.value)
              )
            }
            className={selectClass}
          >
            <option value="0">Off</option>
            <option value="1">Single (！！→！)</option>
            <option value="2">Double (！！！→！！)</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Remove trailing spaces"
          description="Remove spaces at end of lines"
        >
          <Toggle
            checked={cjkFormatting.trailingSpaceRemoval}
            onChange={(v) => updateSetting("trailingSpaceRemoval", v)}
          />
        </SettingRow>
        <SettingRow label="Normalize ellipsis" description=". . . → ...">
          <Toggle
            checked={cjkFormatting.ellipsisNormalization}
            onChange={(v) => updateSetting("ellipsisNormalization", v)}
          />
        </SettingRow>
        <SettingRow label="Collapse newlines" description="3+ newlines → 2">
          <Toggle
            checked={cjkFormatting.newlineCollapsing}
            onChange={(v) => updateSetting("newlineCollapsing", v)}
          />
        </SettingRow>
      </SettingsGroup>
    </div>
  );
}
