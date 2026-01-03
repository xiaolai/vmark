/**
 * Shared Settings Components
 *
 * Common UI components used across settings pages.
 */

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingRow({ label, description, children }: SettingRowProps) {
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

export function Toggle({
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

export function SettingsGroup({
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

export function Select<T extends string>({
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
      className="px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                 bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
