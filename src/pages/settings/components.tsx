/**
 * Shared Settings Components
 *
 * Common UI components used across settings pages.
 * All colors use CSS variables for theme consistency.
 */

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SettingRow({ label, description, children, disabled }: SettingRowProps) {
  return (
    <div className={`flex items-center justify-between py-2.5
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
    <div className={className}>
      <div className="text-base font-semibold text-[var(--text-primary)] mb-3">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
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
      className={`px-2 py-1 rounded border border-[var(--border-color)]
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
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";

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
  const ime = useImeComposition();

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
    if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(inputValue);
    } else if (e.key === "Backspace" && !inputValue && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      className="flex flex-wrap items-center gap-1.5 p-2 rounded border border-[var(--border-color)]
                 bg-[var(--bg-primary)] min-h-[38px] cursor-text"
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
        onCompositionStart={ime.onCompositionStart}
        onCompositionEnd={ime.onCompositionEnd}
        onBlur={() => inputValue && addTag(inputValue)}
        placeholder={value.length === 0 ? placeholder : ""}
        className="flex-1 min-w-[100px] bg-transparent border-none outline-none
                   text-sm text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
      />
    </div>
  );
}

// ============================================================================
// Button Components
// ============================================================================

type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger" | "warning" | "success";
type ButtonSize = "sm" | "md";

interface ButtonProps {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  icon?: React.ReactNode;
  iconPosition?: "left" | "right";
  onClick?: (e: React.MouseEvent) => void;
}

const buttonVariants: Record<ButtonVariant, string> = {
  primary: `bg-[var(--primary-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
  secondary: `bg-transparent text-[var(--text-secondary)] border border-[var(--border-color)]
              hover:bg-[var(--hover-bg)]`,
  tertiary: `bg-[var(--bg-tertiary)] text-[var(--text-primary)]
             hover:bg-[var(--hover-bg)]`,
  danger: `bg-transparent text-[var(--error-color)] border border-[var(--error-color)]/30
           hover:bg-[var(--error-bg)]`,
  warning: `bg-[var(--warning-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
  success: `bg-[var(--success-color)] text-[var(--contrast-text)]
            hover:opacity-90`,
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

export function Button({
  children,
  variant = "secondary",
  size = "sm",
  disabled,
  className = "",
  icon,
  iconPosition = "left",
  onClick,
}: ButtonProps) {
  const content = icon ? (
    <span className="inline-flex items-center gap-1.5">
      {iconPosition === "left" && icon}
      {children}
      {iconPosition === "right" && icon}
    </span>
  ) : (
    children
  );

  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded font-medium transition-colors
                  ${buttonVariants[variant]}
                  ${buttonSizes[size]}
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${className}`}
    >
      {content}
    </button>
  );
}

interface IconButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
  disabled?: boolean;
  className?: string;
  size?: "xs" | "sm" | "md";
}

const iconButtonSizes = {
  xs: "w-5 h-5",
  sm: "w-6 h-6",
  md: "w-7 h-7",
};

export function IconButton({
  children,
  onClick,
  title,
  disabled,
  className = "",
  size = "sm",
}: IconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`${iconButtonSizes[size]} flex items-center justify-center rounded
                  text-[var(--text-tertiary)] hover:text-[var(--text-primary)]
                  hover:bg-[var(--hover-bg)] transition-colors
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${className}`}
    >
      {children}
    </button>
  );
}

// ============================================================================
// Copy Button
// ============================================================================

interface CopyButtonProps {
  text: string;
  size?: "xs" | "sm";
  className?: string;
}

export function CopyButton({ text, size = "sm", className = "" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <button
      onClick={handleCopy}
      className={`p-0.5 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-primary)] transition-colors flex-shrink-0
                  ${className}`}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? (
        <svg className={`${iconSize} text-[var(--success-color)]`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg className={iconSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

// ============================================================================
// Close Button (Dialog)
// ============================================================================

interface CloseButtonProps {
  onClick: () => void;
  className?: string;
}

export function CloseButton({ onClick, className = "" }: CloseButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-primary)] transition-colors ${className}`}
      title="Close"
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
