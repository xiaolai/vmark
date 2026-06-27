/**
 * Heading Picker Component
 *
 * Popup for selecting a document heading to create bookmark links.
 * Shows all headings with indentation by level and filter support.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { calculatePopupPosition, getViewportBounds } from "@/utils/popupPosition";
import type { HeadingWithId } from "@/utils/headingSlug";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useImeComposition } from "@/hooks/useImeComposition";
import { useDismissOnOutsideOrEscape } from "@/hooks/useDismissOnOutsideOrEscape";

const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 280;

interface HeadingItemProps {
  heading: HeadingWithId;
  isSelected: boolean;
  onSelect: () => void;
}

function HeadingItem({ heading, isSelected, onSelect }: HeadingItemProps) {
  const { t } = useTranslation("editor");
  const indent = (heading.level - 1) * 16;

  return (
    <button
      type="button"
      className={`heading-picker-item ${isSelected ? "selected" : ""}`}
      style={{ paddingLeft: `${12 + indent}px` }}
      onClick={onSelect}
      data-heading-id={heading.id}
    >
      <span className="heading-picker-level">H{heading.level}</span>
      <span className="heading-picker-text">{heading.text || t("headingPicker.empty.heading")}</span>
      <span className="heading-picker-id">#{heading.id}</span>
    </button>
  );
}

/** Renders a popup for selecting a document heading to create bookmark links. */
export function HeadingPicker() {
  const { t } = useTranslation("editor");
  const isOpen = useHeadingPickerStore((s) => s.isOpen);
  const headings = useHeadingPickerStore((s) => s.headings);
  const anchorRect = useHeadingPickerStore((s) => s.anchorRect);
  const containerBounds = useHeadingPickerStore((s) => s.containerBounds);

  const ime = useImeComposition();

  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<Element | null>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Find editor container for portal mounting. Legitimate setState-in-effect: the
  // target is read from the DOM after mount, so it can't be resolved during
  // render (#1063).
  useEffect(() => {
    const editorContainer = document.querySelector('.editor-container') as HTMLElement | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPortalTarget(editorContainer);
  }, []);

  const filteredHeadings = headings.filter((h) => {
    if (!filter) return true;
    const search = filter.toLowerCase();
    return h.text.toLowerCase().includes(search) || h.id.toLowerCase().includes(search);
  });

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current;
    previousFocusRef.current = null;
    /* v8 ignore next 3 -- @preserve reason: DOM focus restoration depends on runtime element lifecycle; not exercisable in jsdom tests */
    if (el instanceof HTMLElement && document.contains(el)) {
      requestAnimationFrame(() => el.focus());
    }
  }, []);

  const handleClose = useCallback(() => {
    useHeadingPickerStore.getState().closePicker();
    setFilter("");
    setSelectedIndex(0);
    restoreFocus();
  }, [restoreFocus]);

  const handleSelect = useCallback(
    (heading: HeadingWithId) => {
      useHeadingPickerStore.getState().selectHeading(heading);
      setFilter("");
      setSelectedIndex(0);
      restoreFocus();
    },
    [restoreFocus]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isImeKeyEvent(e.nativeEvent) || ime.isComposing()) return;
      const maxIndex = filteredHeadings.length - 1;
      /* v8 ignore start -- @preserve reason: else-if chain branches not fully exercised in tests */
      if (e.key === "Tab") {
        // Focus trap: cycle within the picker
        const focusable = containerRef.current?.querySelectorAll<HTMLElement>(
          'input, button, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable && focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (maxIndex >= 0) {
          setSelectedIndex((prev) => Math.min(prev + 1, maxIndex));
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (maxIndex >= 0) {
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        const selected = filteredHeadings[selectedIndex];
        if (selected) {
          handleSelect(selected);
        }
      }
      /* v8 ignore stop */
    },
    [filteredHeadings, selectedIndex, handleClose, handleSelect, ime]
  );

  // Click outside to close. Escape is handled by the component's own
  // onKeyDown (preventDefault + Tab focus trap), so only the outside-click
  // half is delegated here. Deferred attach prevents the opening click from
  // immediately dismissing; bubble phase matches the original code.
  useDismissOnOutsideOrEscape(isOpen, containerRef, handleClose, {
    deferActivation: true,
    escape: false,
    capture: false,
  });

  // Calculate popup position when opening. Legitimate setState-in-effect: depends
  // on DOM measurement (portalTarget.getBoundingClientRect) that is only valid
  // after layout, not during render (#1063).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!isOpen) return;

    // Use container bounds if provided, otherwise fall back to viewport bounds
    const bounds = containerBounds ?? getViewportBounds();

    // Default anchor if none provided (center-top)
    const anchor = anchorRect ?? {
      top: bounds.vertical.top + 100,
      bottom: bounds.vertical.top + 120,
      left: (bounds.horizontal.left + bounds.horizontal.right) / 2 - POPUP_WIDTH / 2,
      right: (bounds.horizontal.left + bounds.horizontal.right) / 2 + POPUP_WIDTH / 2,
    };

    const { top, left } = calculatePopupPosition({
      anchor,
      popup: { width: POPUP_WIDTH, height: POPUP_MAX_HEIGHT },
      bounds,
      gap: 6,
      preferAbove: false,
    });

    // Convert to host-relative coordinates if mounted inside editor container
    if (portalTarget && portalTarget !== document.body) {
      const hostRect = portalTarget.getBoundingClientRect();
      setPosition({
        top: top - hostRect.top + portalTarget.scrollTop,
        left: left - hostRect.left + portalTarget.scrollLeft,
      });
    } else {
      setPosition({ top, left });
    }
  }, [isOpen, anchorRect, containerBounds, portalTarget]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Clamp the selection when the filtered list shrinks. Adjusted during render
  // (converges immediately) rather than in an effect (#1063).
  if (filteredHeadings.length === 0) {
    if (selectedIndex !== 0) setSelectedIndex(0);
  } else if (selectedIndex > filteredHeadings.length - 1) {
    setSelectedIndex(filteredHeadings.length - 1);
  }

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(".heading-picker-item.selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Save previous focus and auto-focus input when opening
  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement;
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Use editor container if available, otherwise fall back to document.body
  const mountTarget = portalTarget ?? document.body;

  return createPortal(
    <div
      ref={containerRef}
      className="heading-picker"
      role="dialog"
      aria-modal="true"
      aria-label={t("headingPicker.ariaLabel")}
      tabIndex={-1}
      style={{
        position: portalTarget ? "absolute" : "fixed",
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="heading-picker-header">
        <input
          ref={inputRef}
          type="text"
          className="heading-picker-filter popup-input"
          placeholder={t("headingPicker.filter.placeholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          onCompositionStart={() => ime.onCompositionStart()}
          onCompositionEnd={() => ime.onCompositionEnd()}
        />
      </div>

      <div className="heading-picker-list" ref={listRef}>
        {filteredHeadings.length === 0 ? (
          <div className="heading-picker-empty">
            {headings.length === 0
              ? t("headingPicker.empty.noHeadings")
              : t("headingPicker.empty.noMatch")}
          </div>
        ) : (
          filteredHeadings.map((heading, index) => (
            <HeadingItem
              key={`${heading.id}-${heading.pos}`}
              heading={heading}
              isSelected={index === selectedIndex}
              onSelect={() => handleSelect(heading)}
            />
          ))
        )}
      </div>
    </div>,
    mountTarget
  );
}
