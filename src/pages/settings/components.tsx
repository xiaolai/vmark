/**
 * Shared Settings Components
 *
 * Common UI components used across settings pages.
 */

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SettingRow({ label, description, children, disabled }: SettingRowProps) {
  return (
    <div className={`flex items-center justify-between py-3 border-b border-gray-200 dark:border-gray-700
                     ${disabled ? "opacity-50" : ""}`}>
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
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative w-7 h-4 rounded-full transition-colors
                  ${checked ? "bg-[var(--accent-primary)]" : "bg-[var(--bg-tertiary)]"}
                  ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
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
  disabled,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={`px-2 py-1 rounded border border-gray-200 dark:border-gray-700
                 bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]
                 ${disabled ? "cursor-not-allowed" : ""}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

import { useState, useRef } from "react";
import { ChevronRight } from "lucide-react";

/**
 * Collapsible settings group for optional/advanced sections.
 */
export function CollapsibleGroup({
  title,
  description,
  defaultOpen = false,
  children,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2
                   hover:text-[var(--text-secondary)] transition-colors"
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {title}
      </button>
      {description && (
        <p className="text-xs text-[var(--text-tertiary)] ml-6 mb-2">
          {description}
        </p>
      )}
      {open && <div className="ml-6">{children}</div>}
    </div>
  );
}

/**
 * Tag input component for managing a list of string values.
 * Used for custom link protocols.
 */
export function TagInput({
  value,
  onChange,
  placeholder = "Add item...",
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const addTag = (tag: string) => {
    const trimmed = tag.trim().toLowerCase();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
    }
    setInputValue("");
  };

  const removeTag = (tag: string) => {
    onChange(value.filter((t) => t !== tag));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 p-2 rounded border border-gray-200
                 dark:border-gray-700 bg-[var(--bg-primary)] min-h-[38px] cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full
                     bg-[var(--bg-tertiary)] text-xs text-[var(--text-primary)]"
        >
          {tag}://
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              removeTag(tag);
            }}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                       focus:outline-none"
            aria-label={`Remove ${tag}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => inputValue && addTag(inputValue)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[100px] bg-transparent border-none outline-none
                   text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
      />
    </div>
  );
}
