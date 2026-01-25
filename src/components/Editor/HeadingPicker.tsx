/**
 * Heading Picker Component
 *
 * Popup for selecting a document heading to create bookmark links.
 * Shows all headings with indentation by level and filter support.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useHeadingPickerStore } from "@/stores/headingPickerStore";
import { calculatePopupPosition, getViewportBounds } from "@/utils/popupPosition";
import type { HeadingWithId } from "@/utils/headingSlug";

const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 280;

interface HeadingItemProps {
  heading: HeadingWithId;
  isSelected: boolean;
  onSelect: () => void;
}

function HeadingItem({ heading, isSelected, onSelect }: HeadingItemProps) {
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
      <span className="heading-picker-text">{heading.text || "(empty heading)"}</span>
      <span className="heading-picker-id">#{heading.id}</span>
    </button>
  );
}

export function HeadingPicker() {
  const isOpen = useHeadingPickerStore((s) => s.isOpen);
  const headings = useHeadingPickerStore((s) => s.headings);
  const anchorRect = useHeadingPickerStore((s) => s.anchorRect);
  const containerBounds = useHeadingPickerStore((s) => s.containerBounds);

  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Find editor container for portal mounting
  useEffect(() => {
    const editorContainer = document.querySelector('.editor-container') as HTMLElement | null;
    setPortalTarget(editorContainer);
  }, []);

  const filteredHeadings = headings.filter((h) => {
    if (!filter) return true;
    const search = filter.toLowerCase();
    return h.text.toLowerCase().includes(search) || h.id.toLowerCase().includes(search);
  });

  const handleClose = useCallback(() => {
    useHeadingPickerStore.getState().closePicker();
    setFilter("");
    setSelectedIndex(0);
  }, []);

  const handleSelect = useCallback(
    (heading: HeadingWithId) => {
      useHeadingPickerStore.getState().selectHeading(heading);
      setFilter("");
      setSelectedIndex(0);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const maxIndex = filteredHeadings.length - 1;
      if (e.key === "Escape") {
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
    },
    [filteredHeadings, selectedIndex, handleClose, handleSelect]
  );

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    // Delay to prevent immediate close from same click
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, handleClose]);

  // Calculate popup position when opening
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

  // Reset and clamp selection when filter changes
  useEffect(() => {
    setSelectedIndex((prev) => {
      if (filteredHeadings.length === 0) return 0;
      return Math.min(prev, filteredHeadings.length - 1);
    });
  }, [filter, filteredHeadings.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector(".heading-picker-item.selected");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Focus input when opening
  useEffect(() => {
    if (isOpen) {
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
          placeholder="Filter headings..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div className="heading-picker-list" ref={listRef}>
        {filteredHeadings.length === 0 ? (
          <div className="heading-picker-empty">
            {headings.length === 0
              ? "No headings in document"
              : "No headings match filter"}
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
