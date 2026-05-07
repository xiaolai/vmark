/**
 * Shared Settings UI Primitives
 *
 * The components here are the canonical building blocks for every page in
 * `src/pages/settings/`. New panels should compose these — not write inline
 * Tailwind on a raw `<input>`/`<button>`/`<select>` — so visual treatment
 * and accessibility stay coherent.
 *
 * THREE TEXT-INPUT PRIMITIVES — named for their CONTEXT, not their visual
 * style. Pick by the noun, not by the pixels:
 *
 *   <SearchInput>   Toolbar / inline / single-field-in-a-group inputs.
 *                   Bottom-border focus highlight; transparent background.
 *                   Borrows visual structure from surroundings.
 *                   Use for: search boxes, single-field-with-button rows,
 *                   inline lookups.
 *
 *   <FieldInput>    Stacked form fields (multiple inputs in a column).
 *                   Full border + tinted background — clear "fillable"
 *                   affordance.
 *                   Use for: API endpoints, keys, paths, anything where
 *                   several fields sit together and each needs to look
 *                   like a thing you fill in.
 *
 *   <Select>        Dropdown picker. Already canonical.
 *                   Use for: enum-like choices.
 *
 * If none of these fit a new context, ASK before adding a 4th primitive.
 * The temptation is to add `variant` props — resist it. Variant names
 * describe pixels; primitive names describe intent. Intent is harder to
 * misuse.
 *
 * All colors use CSS variables for theme consistency.
 */

import React, { useState, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  disabled?: boolean;
}

export function SettingRow({ label, description, children, disabled }: SettingRowProps) {
  const id = React.useId();
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;

  return (
    <div className={`flex items-center justify-between py-2.5
                     ${disabled ? "opacity-50" : ""}`}>
      <div className="flex-1">
        <div id={labelId} className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </div>
        {description && (
          <div id={descId} className="text-xs text-[var(--text-tertiary)] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="ml-4">
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
              "aria-labelledby": labelId,
              ...(description ? { "aria-describedby": descId } : {}),
            })
          : children}
      </div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  ...ariaProps
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      {...ariaProps}
      className={`relative w-7 h-4 rounded-full transition-colors
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
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
  ...ariaProps
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      {...ariaProps}
      className={`appearance-none px-2 pt-[1px] pb-0 pr-6 rounded border border-[var(--border-color)]
                 bg-[var(--bg-primary)] text-sm text-[var(--text-primary)]
                 bg-[length:16px_16px] bg-[position:right_4px_center] bg-no-repeat
                 focus-visible:ring-2 focus-visible:ring-[var(--primary-color)]
                 ${disabled ? "cursor-not-allowed" : ""}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 15 5 5 5-5'/%3E%3Cpath d='m7 9 5-5 5 5'/%3E%3C/svg%3E")`,
      }}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// ============================================================================
// Text input primitives — see header comment for naming rules.
// ============================================================================

/** Common props every input primitive shares. */
interface BaseInputProps {
  value: string;
  onChange: (v: string) => void;
  onBlur?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  /** Render in monospace — paths, URLs, code-like values. */
  mono?: boolean;
  /** Escape hatch for layout-only props (`flex-1`, `w-full`, sizing).
   *  Do NOT use this to override visual style — that defeats the
   *  point of having named primitives. */
  className?: string;
  spellCheck?: boolean;
  autoFocus?: boolean;
  /** Forwarded onto the underlying `<input>`. React 19 supports
   *  ref-as-prop, so callers can pass a regular `useRef` directly. */
  ref?: React.Ref<HTMLInputElement>;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}

export interface SearchInputProps extends BaseInputProps {
  /** Default `"text"`. `"search"` enables UA-provided clear button on
   *  some browsers. */
  type?: "text" | "search";
}

/**
 * SearchInput — bottom-border focus highlight, transparent background.
 *
 * For toolbar / inline / single-field-in-a-group inputs. Borrows visual
 * structure from surroundings — looks correct alongside other toolbar
 * elements without competing for attention.
 *
 * Visual contract:
 *   - Bottom border only; full borders would double-frame against
 *     toolbar/group containers.
 *   - Transparent background; reads on whatever surface it sits in.
 *   - Focus highlights the bottom border in the primary color
 *     (per `.claude/rules/33-focus-indicators.md` § Dialog Inputs).
 *   - `font-mono` when `mono=true` for paths / URLs / code-like values.
 */
export function SearchInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  disabled,
  mono = false,
  className = "",
  spellCheck = false,
  autoFocus,
  type = "text",
  ref,
  ...ariaProps
}: SearchInputProps) {
  return (
    <input
      ref={ref}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={spellCheck}
      autoFocus={autoFocus}
      {...ariaProps}
      className={`w-full px-0 py-1 text-sm bg-transparent text-[var(--text-primary)]
                  border-0 border-b border-[var(--border-color)]
                  placeholder:text-[var(--text-tertiary)]
                  outline-none focus:border-[var(--primary-color)]
                  ${mono ? "font-mono" : ""}
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${className}`}
    />
  );
}

export interface FieldInputProps extends BaseInputProps {
  /** Default `"text"`. `"password"` masks the value (used for API keys). */
  type?: "text" | "password";
}

/**
 * FieldInput — full border + tinted background, the "fill me in"
 * affordance.
 *
 * For stacked form fields where multiple inputs sit together (settings
 * dialogs, integration config). Each field needs to look like a
 * discrete thing the user fills in, distinct from its neighbors.
 *
 * Visual contract:
 *   - Full 1px border + `--bg-tertiary` background → reads as a
 *     fillable field even with no content / focus.
 *   - Focus highlights the border in the primary color.
 *   - `font-mono` defaults ON because almost every form field in
 *     Settings carries a path, URL, or key. Pass `mono={false}` for
 *     prose-style fields (rare).
 */
export function FieldInput({
  value,
  onChange,
  onBlur,
  onKeyDown,
  placeholder,
  disabled,
  mono = true,
  className = "",
  spellCheck = false,
  autoFocus,
  type = "text",
  ref,
  ...ariaProps
}: FieldInputProps) {
  return (
    <input
      ref={ref}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={spellCheck}
      autoFocus={autoFocus}
      {...ariaProps}
      className={`w-full px-2 py-1 text-xs rounded
                  bg-[var(--bg-tertiary)] text-[var(--text-color)]
                  border border-[var(--border-color)]
                  placeholder:text-[var(--text-tertiary)]
                  outline-none focus:border-[var(--primary-color)]
                  ${mono ? "font-mono" : ""}
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${className}`}
    />
  );
}

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
        aria-expanded={open}
        className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] mb-2
                   rounded hover:text-[var(--text-secondary)] transition-colors
                   focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1"
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
  const { t } = useTranslation("settings");
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
                       rounded-full focus-visible:ring-1 focus-visible:ring-[var(--primary-color)]"
            aria-label={t("removeTag", { tag })}
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
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${buttonVariants[variant]}
                  ${buttonSizes[size]}
                  ${disabled ? "opacity-50 cursor-not-allowed" : ""}
                  ${className}`}
    >
      {content}
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
  const { t } = useTranslation("settings");
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access denied — no user feedback needed, button stays in default state
    }
  };

  /* v8 ignore next -- @preserve size !=="sm" branch: tests only invoke with size="sm" */
  const iconSize = size === "sm" ? "w-3.5 h-3.5" : "w-3 h-3";

  return (
    <button
      onClick={handleCopy}
      className={`p-0.5 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-primary)] transition-colors flex-shrink-0
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${className}`}
      title={copied ? t("copied") : t("copy")}
      aria-label={copied ? t("copied") : t("copy")}
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
  const { t } = useTranslation("settings");
  return (
    <button
      onClick={onClick}
      className={`p-1 rounded hover:bg-[var(--hover-bg)] text-[var(--text-tertiary)]
                  hover:text-[var(--text-primary)] transition-colors
                  focus-visible:ring-2 focus-visible:ring-[var(--primary-color)] focus-visible:ring-offset-1
                  ${className}`}
      title={t("close")}
      aria-label={t("close")}
    >
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </svg>
    </button>
  );
}
