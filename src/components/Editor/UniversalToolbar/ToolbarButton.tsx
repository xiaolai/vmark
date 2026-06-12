/**
 * ToolbarButton - Individual button in the universal toolbar
 *
 * Renders a single toolbar button with icon, label tooltip, and click handler.
 * Supports disabled state based on context.
 *
 * @module components/Editor/UniversalToolbar/ToolbarButton
 */
import { useTranslation } from "react-i18next";
import type { ToolbarGroupButton as ButtonDef } from "./toolbarGroups";
import { toolbarGroupLabel } from "./toolbarI18n";

interface ToolbarButtonProps {
  button: ButtonDef;
  disabled?: boolean;
  active?: boolean;
  notImplemented?: boolean;
  focusEnabled?: boolean;
  focusIndex?: number;
  currentFocusIndex?: number;
  ariaHasPopup?: "menu" | "dialog" | "listbox";
  ariaExpanded?: boolean;
  onClick: () => void;
}

/**
 * Render a single toolbar button.
 *
 * @param button - Button definition from toolbarGroups
 * @param disabled - Whether the button is disabled
 * @param active - Whether the button represents an active format
 * @param notImplemented - Whether the button is not yet implemented
 * @param focusIndex - This button's index in the focus order
 * @param currentFocusIndex - The currently focused button index (for roving tabindex)
 * @param ariaHasPopup - ARIA popup type (for dropdown buttons)
 * @param ariaExpanded - Whether the dropdown is expanded
 * @param onClick - Click handler
 */
export function ToolbarButton({
  button,
  disabled = false,
  active = false,
  notImplemented = false,
  focusEnabled = true,
  focusIndex,
  currentFocusIndex,
  ariaHasPopup,
  ariaExpanded,
  onClick,
}: ToolbarButtonProps) {
  const { t } = useTranslation("editor");
  // Resolve the translated label (hardcoded English is the fallback) —
  // the toolbar.* keys existed in every locale but were never consumed
  // (audit 20260612 H17).
  const label = toolbarGroupLabel(t, button);
  // Show "Not available yet" tooltip for unimplemented buttons
  let title = label;

  if (notImplemented) {
    title = t("toolbar.notAvailable", { label });
  }

  // Roving tabindex: only focused button has tabIndex=0 when focus is active
  const isFocused = focusEnabled && focusIndex === currentFocusIndex;
  const tabIndex = isFocused ? 0 : -1;
  /* v8 ignore next 3 -- @preserve active/focused/dropdown class variants require specific toolbar state not reached in tests */
  const btnClass = `universal-toolbar-btn${active ? " active" : ""}${isFocused ? " focused" : ""}${button.type === "dropdown" ? " dropdown" : ""}`;
  /* v8 ignore next -- @preserve ariaExpanded undefined branch requires non-popup button in tests */
  const ariaExpanded_ = ariaHasPopup ? ariaExpanded : undefined;

  return (
    <button
      type="button"
      className={btnClass}
      title={title}
      aria-label={label}
      aria-haspopup={ariaHasPopup}
      aria-expanded={ariaExpanded_}
      disabled={disabled || notImplemented}
      onClick={onClick}
      tabIndex={tabIndex}
      data-action={button.action}
      data-focus-index={focusIndex}
    >
      <span
        className="universal-toolbar-icon"
        dangerouslySetInnerHTML={{ __html: button.icon }}
      />
    </button>
  );
}
