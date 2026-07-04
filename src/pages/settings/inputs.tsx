/**
 * Settings input primitives — Toggle, Select, SearchInput, FieldInput.
 *
 * Part of the shared Settings UI primitives; see `components.tsx` (the
 * barrel) for the naming/decision rules that govern this family — in
 * particular the SearchInput vs FieldInput vs Select decision rule.
 */

import React from "react";
import { ChevronsUpDown } from "lucide-react";

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
        className={`absolute top-[3px] left-[3px] w-2.5 h-2.5 rounded-full bg-[var(--contrast-text)] shadow
                    transition-transform ${checked ? "translate-x-3" : ""}`}
      />
    </button>
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
    <span className="relative inline-flex">
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        {...ariaProps}
        className={`appearance-none px-2 pt-[1px] pb-0 pr-6 rounded border border-[var(--border-color)]
                   bg-[var(--bg-color)] text-sm text-[var(--text-color)]
                   focus-visible:ring-2 focus-visible:ring-[var(--primary-color)]
                   ${disabled ? "cursor-not-allowed" : ""}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Chevron rendered as an inline icon (currentColor) instead of a
          data-URI background so the color comes from a theme token and
          adapts to dark mode (31-design-tokens). */}
      <ChevronsUpDown
        aria-hidden="true"
        className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 w-4 h-4
                   text-[var(--text-tertiary)]"
      />
    </span>
  );
}

// ============================================================================
// Text input primitives — see the barrel header comment for naming rules.
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
      className={`w-full px-0 py-1 text-sm bg-transparent text-[var(--text-color)]
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
