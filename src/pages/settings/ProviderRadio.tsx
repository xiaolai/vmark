/**
 * ProviderRadio — the small radio button used in the AI provider list.
 *
 * Kept in its own file (rather than co-located inside
 * IntegrationsSettings.tsx) so the a11y test for audit #953 can import
 * just this component, instead of pulling the whole 60-line page module
 * into the coverage denominator with no other tests to balance it.
 */

interface ProviderRadioProps {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  /** Screen-reader name for this radio — provider display name. The visible
   *  name lives in a sibling <span> and is not programmatically associated
   *  with the button, so without aria-label SRs hear only
   *  "radio button, not checked" (audit #953). */
  label: string;
}

export function ProviderRadio({
  checked,
  disabled,
  onChange,
  label,
}: ProviderRadioProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`w-3.5 h-3.5 rounded-full border flex-shrink-0
        flex items-center justify-center transition-colors
        ${disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
        ${checked
          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]"
          : "border-[var(--text-tertiary)] bg-transparent hover:border-[var(--text-secondary)]"
        }`}
    >
      {checked && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--contrast-text)]" />
      )}
    </button>
  );
}
