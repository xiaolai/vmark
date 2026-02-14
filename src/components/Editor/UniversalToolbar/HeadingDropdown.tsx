/**
 * HeadingDropdown
 *
 * Purpose: Dropdown menu for selecting heading levels (H1-H6) or paragraph from the toolbar.
 * Auto-focuses the currently active heading level on open.
 *
 * User interactions: Arrow keys navigate, Enter/click selects, Escape closes.
 *
 * @coordinates-with UniversalToolbar.tsx — rendered as a child dropdown
 * @module components/Editor/UniversalToolbar/HeadingDropdown
 */
import { forwardRef, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface HeadingDropdownProps {
  anchorRect: DOMRect;
  currentLevel: number;
  onSelect: (level: number) => void;
  onClose: () => void;
}

const HeadingDropdown = forwardRef<HTMLDivElement, HeadingDropdownProps>(
  ({ anchorRect, currentLevel, onSelect, onClose }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const options = useMemo(
      () => [
        { level: 0, label: "Paragraph" },
        { level: 1, label: "Heading 1" },
        { level: 2, label: "Heading 2" },
        { level: 3, label: "Heading 3" },
        { level: 4, label: "Heading 4" },
        { level: 5, label: "Heading 5" },
        { level: 6, label: "Heading 6" },
      ],
      []
    );

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const buttons = container.querySelectorAll<HTMLButtonElement>(
        ".universal-toolbar-dropdown-item"
      );
      const targetIndex = Math.max(0, options.findIndex((option) => option.level === currentLevel));
      const targetButton = buttons[targetIndex] ?? buttons[0];
      targetButton?.focus();
    }, [currentLevel, options]);

    const handleKeyDown = (event: ReactKeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "Tab") {
        event.preventDefault();
        const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
          ".universal-toolbar-dropdown-item"
        );
        if (!buttons || buttons.length === 0) return;
        const activeIndex = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.shiftKey ? -1 : 1;
        const nextIndex = (activeIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const buttons = containerRef.current?.querySelectorAll<HTMLButtonElement>(
          ".universal-toolbar-dropdown-item"
        );
        if (!buttons || buttons.length === 0) return;
        const activeIndex = Array.from(buttons).indexOf(document.activeElement as HTMLButtonElement);
        const direction = event.key === "ArrowDown" ? 1 : -1;
        const nextIndex = (activeIndex + direction + buttons.length) % buttons.length;
        buttons[nextIndex]?.focus();
      }
    };

    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
        }}
        className="universal-toolbar-dropdown"
        style={{ top: anchorRect.top - 8, left: anchorRect.left }}
        onKeyDown={handleKeyDown}
        role="menu"
        aria-label="Heading levels"
      >
        {options.map((option) => (
          <button
            key={option.level}
            type="button"
            className={`universal-toolbar-dropdown-item${option.level === currentLevel ? " active" : ""}`}
            onClick={() => onSelect(option.level)}
          >
            {option.label}
          </button>
        ))}
      </div>
    );
  }
);

HeadingDropdown.displayName = "HeadingDropdown";

export { HeadingDropdown };
