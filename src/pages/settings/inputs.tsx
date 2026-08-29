/**
 * Settings input primitives — Toggle, Select, SearchInput, FieldInput.
 *
 * Part of the shared Settings UI primitives; see `components.tsx` (the
 * barrel) for the naming/decision rules that govern this family — in
 * particular the SearchInput vs FieldInput vs Select decision rule.
 */

import React from "react";

export function Toggle({
  checked,
  onChange,
  disabled,
  id,
  ...ariaProps
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  // WI-UI3.4: thin wrapper over the canonical `.vm-switch` (panel-shared.css).
  return (
    <button
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      id={id}
      onClick={() => !disabled && onChange(!checked)}
      {...ariaProps}
      className="vm-switch"
    >
      <span className="vm-switch__knob" />
    </button>
  );
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  id,
  ...ariaProps
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  id?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  // WI-UI2.4: thin wrapper over the canonical `.vm-select` primitive
  // (select-shared.css) — the wrapper span owns the chevron via ::after.
  return (
    <span className="vm-select-field w-auto!">
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        {...ariaProps}
        className="vm-select"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
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
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onCompositionStart?: (e: React.CompositionEvent<HTMLInputElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLInputElement>) => void;
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
      className={`vm-input w-full ${mono ? "vm-input--mono" : ""} ${className}`.replace(/\s+/g, " ").trim()}
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
  onFocus,
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
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
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={spellCheck}
      autoFocus={autoFocus}
      {...ariaProps}
      className={`vm-input vm-input--field w-full ${mono ? "vm-input--mono" : ""} ${className}`.replace(/\s+/g, " ").trim()}
    />
  );
}
