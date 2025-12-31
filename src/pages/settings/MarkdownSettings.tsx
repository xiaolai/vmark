import { useSettingsStore, type MediaBorderStyle } from "@/stores/settingsStore";

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

function Select<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="text-xs px-2 py-1 rounded border border-[var(--border-primary)]
                 bg-[var(--bg-primary)] text-[var(--text-primary)]
                 focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
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
