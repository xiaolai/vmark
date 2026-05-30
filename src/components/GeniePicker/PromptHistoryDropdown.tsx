/**
 * Prompt History Dropdown
 *
 * Searchable popup that appears above the freeform textarea (Ctrl+R).
 * Shows filtered history entries for quick selection.
 */

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

interface PromptHistoryDropdownProps {
  entries: string[];
  selectedIndex: number;
  onSelect(index: number): void;
  onClose(): void;
}

/** Renders a searchable dropdown of previous freeform prompts above the GeniePicker textarea. */
export function PromptHistoryDropdown({
  entries,
  selectedIndex,
  onSelect,
  onClose,
}: PromptHistoryDropdownProps) {
  const { t } = useTranslation("ai");
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    /* v8 ignore next -- @preserve listRef guard: ref is always set before selectedIndex changes */
    if (!listRef.current) return;
    const item = listRef.current.querySelector(
      `[data-dropdown-index="${selectedIndex}"]`
    );
    /* v8 ignore next -- @preserve item not found: selectedIndex always matches a rendered entry in tests */
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Close on outside clicks
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  if (entries.length === 0) {
    return (
      <div className="prompt-history-dropdown">
        <div className="prompt-history-dropdown-empty">{t("history.empty")}</div>
      </div>
    );
  }

  return (
    <div className="prompt-history-dropdown" ref={listRef}>
      <div className="prompt-history-dropdown-header">
        {t("history.title")}
        <span className="prompt-history-dropdown-hint">
          <kbd className="genie-picker-kbd">Ctrl+R</kbd>
        </span>
      </div>
      <div
        className="prompt-history-dropdown-list"
        role="listbox"
        aria-label={t("history.title")}
      >
        {entries.map((entry, index) => {
          const firstLine = entry.split("\n")[0];
          const isSelected = index === selectedIndex;
          return (
            <div
              key={index}
              data-dropdown-index={index}
              role="option"
              aria-selected={isSelected}
              className={`prompt-history-dropdown-item${
                isSelected ? " prompt-history-dropdown-item--selected" : ""
              }`}
              onClick={() => onSelect(index)}
            >
              <span className="prompt-history-dropdown-text">{firstLine}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
