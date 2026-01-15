/**
 * ToolbarButton - Individual button in the universal toolbar
 *
 * Renders a single toolbar button with icon, label tooltip, and click handler.
 * Supports disabled state based on context.
 *
 * @module components/Editor/UniversalToolbar/ToolbarButton
 */
import type { ToolbarButton as ButtonDef } from "./toolbarGroups";

interface ToolbarButtonProps {
  button: ButtonDef;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void;
}

/**
 * Render a single toolbar button.
 *
 * @param button - Button definition from toolbarGroups
 * @param disabled - Whether the button is disabled
 * @param active - Whether the button represents an active format
 * @param onClick - Click handler
 */
export function ToolbarButton({
  button,
  disabled = false,
  active = false,
  onClick,
}: ToolbarButtonProps) {
  const title = button.shortcut
    ? `${button.label} (${button.shortcut})`
    : button.label;

  return (
    <button
      type="button"
      className={`universal-toolbar-btn${active ? " active" : ""}`}
      title={title}
      disabled={disabled}
      onClick={onClick}
      tabIndex={-1} // Roving tabindex managed by parent
      data-action={button.action}
    >
      <span
        className="universal-toolbar-icon"
        dangerouslySetInnerHTML={{ __html: button.icon }}
      />
    </button>
  );
}
