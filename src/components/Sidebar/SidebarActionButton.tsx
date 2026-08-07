/**
 * SidebarActionButton
 *
 * Purpose: the one sidebar header/footer button. Five near-identical copies had
 * accumulated in Sidebar.tsx, each repeating the class name, the icon size, and
 * the tooltip/ARIA plumbing — and each computing its shortcut label TWICE, once
 * for `title` and again for `aria-label`, which is how the two drift apart.
 *
 * Key decisions:
 *   - `title` and `aria-label` are the same string by construction, not by
 *     convention. A sighted user and a screen-reader user get the same label.
 *   - `pressed` is optional: passing it makes the button a toggle
 *     (`aria-pressed`), omitting it leaves it a plain action. There is no
 *     third state to get wrong.
 *
 * @coordinates-with Sidebar.tsx — sole caller
 * @module components/Sidebar/SidebarActionButton
 */
import type { LucideIcon } from "lucide-react";
import { formatKeyForDisplay } from "@/stores/settingsStore";
import { tooltipWithShortcut } from "@/utils/tooltipWithShortcut";

interface SidebarActionButtonProps {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  /** Raw shortcut string; appended to the label when present and non-empty. */
  shortcut?: string;
  /** Present ⇒ this is a toggle and reports `aria-pressed`. */
  pressed?: boolean;
  disabled?: boolean;
  size?: number;
}

/** A sidebar icon button whose tooltip and accessible name cannot disagree. */
export function SidebarActionButton({
  label,
  icon: Icon,
  onClick,
  shortcut,
  pressed,
  disabled,
  size = 14,
}: SidebarActionButtonProps) {
  const text = shortcut ? tooltipWithShortcut(label, formatKeyForDisplay(shortcut)) : label;
  return (
    <button
      className="sidebar-btn"
      onClick={onClick}
      title={text}
      aria-label={text}
      aria-pressed={pressed}
      disabled={disabled}
    >
      <Icon size={size} />
    </button>
  );
}
