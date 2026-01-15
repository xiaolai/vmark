/**
 * ToolbarButton - Individual button in the universal toolbar
 *
 * Renders a single toolbar button with icon, label tooltip, and click handler.
 * Supports disabled state based on context.
 *
 * @module components/Editor/UniversalToolbar/ToolbarButton
 */
import type { ToolbarGroupButton as ButtonDef } from "./toolbarGroups";

interface ToolbarButtonProps {
  button: ButtonDef;
  disabled?: boolean;
  active?: boolean;
  notImplemented?: boolean;
  focusIndex?: number;
  currentFocusIndex?: number;
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
 * @param onClick - Click handler
 */
export function ToolbarButton({
  button,
  disabled = false,
  active = false,
  notImplemented = false,
  focusIndex,
  currentFocusIndex,
  onClick,
}: ToolbarButtonProps) {
  // Show "Not available yet" tooltip for unimplemented buttons
  let title = button.label;

  if (notImplemented) {
    title = `${button.label} — Not available yet`;
  }

  // Roving tabindex: only focused button has tabIndex=0
  const tabIndex = focusIndex === currentFocusIndex ? 0 : -1;

  return (
    <button
      type="button"
      className={`universal-toolbar-btn${active ? " active" : ""}${button.type === "dropdown" ? " dropdown" : ""}`}
      title={title}
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
