/**
 * Settings layout primitives — SettingRow, SettingsGroup, CollapsibleGroup,
 * SearchableSection.
 *
 * Part of the shared Settings UI primitives; see `components.tsx` (the
 * barrel) for the naming/decision rules that govern this family.
 */

import React, { useState, useRef } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "./buttons";
import { useSettingsSearchQuery, matchesSettingsQuery } from "./SettingsSearchContext";

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
  const controlId = `${id}-control`;

  // Settings search (D2): when a query is active, the dialog stacks every
  // panel and each row hides itself unless its label/description matches.
  // The hiding is done in CSS via `data-search-visible` so non-search
  // rendering pays nothing. See settings-search.css.
  const query = useSettingsSearchQuery();
  const visible = matchesSettingsQuery(query, label, description);
  // No "button" here on purpose: label activation is the affordance for VALUE
  // controls (toggle, select, field). On a row whose child is an action
  // button, a click on the label TEXT would fire the action — surprising for
  // one-shot buttons like "Detect CLI" or "Reset all settings" (audit round
  // 2, finding 28). Buttons keep aria-labelledby only.
  const LABELABLE_TAGS = new Set(["input", "select", "textarea", "meter", "output", "progress"]);
  const childEl = React.isValidElement(children)
    ? (children as React.ReactElement<Record<string, unknown>>)
    : null;
  const isButtonChild = childEl !== null && (childEl.type === "button" || childEl.type === Button);
  const labelable =
    childEl !== null &&
    !isButtonChild &&
    (typeof childEl.type !== "string" || LABELABLE_TAGS.has(childEl.type));
  // Never overwrite a child-provided id — reference it instead.
  const effectiveControlId = (childEl?.props.id as string | undefined) ?? controlId;

  return (
    <div
      data-setting-row
      data-search-visible={visible}
      className={`flex items-center justify-between py-2.5
                     ${disabled ? "opacity-[var(--opacity-disabled)]" : ""}`}
    >
      <div className="flex-1">
        {/* A real <label htmlFor>, so clicking the row's text activates the
            control (WI-UI2.4) — a switch/select is a labelable element.
            Audit 20260829: a wrapper <div> child is NOT labelable, so the
            htmlFor would dangle — omit it there and keep the aria wiring. */}
        <label
          htmlFor={labelable ? effectiveControlId : undefined}
          id={labelId}
          className="block text-sm font-medium text-[var(--text-color)]"
        >
          {label}
        </label>
        {description && (
          <div id={descId} className="text-xs text-[var(--text-secondary)] mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="ml-4">
        {React.isValidElement(children)
          ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
              id: effectiveControlId,
              "aria-labelledby": labelId,
              ...(description ? { "aria-describedby": descId } : {}),
            })
          : children}
      </div>
    </div>
  );
}

/**
 * SearchableSection — settings-search participation for custom-layout
 * sections that are not built from `SettingRow`.
 *
 * Settings search (D2) hides any group without a visible
 * `[data-setting-row]` child (see settings-search.css), so a section
 * composed of free-form markup is otherwise undiscoverable. This wrapper
 * emits the same data attributes `SettingRow` does, matching `label` and
 * `description` against the active query. Layout is untouched — the
 * wrapper is a plain block element.
 */
export function SearchableSection({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  const query = useSettingsSearchQuery();
  const visible = matchesSettingsQuery(query, label, description);

  return (
    <div data-setting-row data-search-visible={visible}>
      {children}
    </div>
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
    <div className={`settings-search-group ${className}`}>
      <div className="text-base font-semibold text-[var(--text-color)] mb-3">
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
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
  const contentRef = useRef<HTMLDivElement>(null);
  // D5: when the user expands the group, move focus to the first revealed
  // control instead of leaving it on the chevron. Skip the initial mount so a
  // `defaultOpen` group doesn't steal focus on render.
  const mountedRef = useRef(false);
  React.useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    if (!open) return;
    const first = contentRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    first?.focus();
  }, [open]);
  return (
    <div className="mb-6">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="vm-btn vm-btn--plain flex items-center gap-2 text-[var(--text-color)]! font-medium mb-2"
      >
        <ChevronRight
          className={`w-4 h-4 transition-transform ${open ? "rotate-90" : ""}`}
        />
        {title}
      </button>
      {description && (
        <p className="text-xs text-[var(--text-secondary)] ml-6 mb-2">
          {description}
        </p>
      )}
      {open && <div ref={contentRef} className="ml-6">{children}</div>}
    </div>
  );
}
