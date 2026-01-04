/**
 * Source Format Popup Component
 *
 * Floating toolbar for markdown formatting and table editing in source mode.
 * Shows format buttons when text is selected, table buttons when in a table.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import {
  calculatePopupPosition,
  getBoundaryRects,
  getViewportBounds,
  type PopupPosition,
} from "@/utils/popupPosition";
import { hasFormat, type FormatType } from "./formatActions";
import { FormatMode, TableMode, CodeMode, HeadingMode } from "./modes";
import { ALL_FORMAT_BUTTONS } from "./buttonDefs";
import "./source-format.css";

export function SourceFormatPopup() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [activeFormats, setActiveFormats] = useState<Set<FormatType>>(
    new Set()
  );
  const justOpenedRef = useRef(false);

  const isOpen = useSourceFormatStore((state) => state.isOpen);
  const mode = useSourceFormatStore((state) => state.mode);
  const contextMode = useSourceFormatStore((state) => state.contextMode);
  const anchorRect = useSourceFormatStore((state) => state.anchorRect);
  const editorView = useSourceFormatStore((state) => state.editorView);
  const tableInfo = useSourceFormatStore((state) => state.tableInfo);
  const headingInfo = useSourceFormatStore((state) => state.headingInfo);
  const codeFenceInfo = useSourceFormatStore((state) => state.codeFenceInfo);

  // Calculate position when popup opens or anchor changes
  useEffect(() => {
    if (!isOpen || !anchorRect || !containerRef.current || !editorView) {
      setPosition(null);
      return;
    }

    // Measure popup dimensions
    const popup = containerRef.current;
    const width = popup.offsetWidth || 200;
    const height = popup.offsetHeight || 36;

    // Get boundaries: horizontal from CodeMirror dom, vertical from editor container
    const cmDom = editorView.dom as HTMLElement;
    const containerEl = cmDom.closest(".editor-container") as HTMLElement;
    const bounds = containerEl
      ? getBoundaryRects(cmDom, containerEl)
      : getViewportBounds();

    const pos = calculatePopupPosition({
      anchor: anchorRect,
      popup: { width, height },
      bounds,
      gap: 8,
      preferAbove: true,
    });

    setPosition(pos);

    // Mark as just opened
    justOpenedRef.current = true;
    requestAnimationFrame(() => {
      justOpenedRef.current = false;
    });
  }, [isOpen, anchorRect, mode, contextMode, editorView]);

  // Update active formats when editor view changes (only in format mode)
  useEffect(() => {
    if (!isOpen || !editorView || mode !== "format") {
      setActiveFormats(new Set());
      return;
    }

    const formats = new Set<FormatType>();
    ALL_FORMAT_BUTTONS.forEach(({ type }) => {
      if (hasFormat(editorView, type)) {
        formats.add(type);
      }
    });
    setActiveFormats(formats);
  }, [isOpen, editorView, mode]);

  // Get all focusable elements in the popup
  const getFocusableElements = useCallback(() => {
    if (!containerRef.current) return [];
    return Array.from(
      containerRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );
  }, []);

  // Focus first element when popup opens
  useEffect(() => {
    if (!isOpen || !position) return;

    // Delay to ensure DOM is ready
    const timer = setTimeout(() => {
      const focusable = getFocusableElements();
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, position, getFocusableElements]);

  // Handle click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handleMouseDown = (e: MouseEvent) => {
      // Prevent closing on same click that opened
      if (justOpenedRef.current) return;

      const popup = containerRef.current;
      if (popup && !popup.contains(e.target as Node)) {
        useSourceFormatStore.getState().closePopup();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+E (Mod-e): toggle - close popup when already open
      // Skip if just opened (same keypress that opened the popup)
      if (e.key === "e" && (e.metaKey || e.ctrlKey)) {
        if (justOpenedRef.current) return;
        e.preventDefault();
        useSourceFormatStore.getState().closePopup();
        editorView?.focus();
        return;
      }

      if (e.key === "Escape") {
        useSourceFormatStore.getState().closePopup();
        editorView?.focus();
        return;
      }

      // Tab navigation within popup
      if (e.key === "Tab") {
        const focusable = getFocusableElements();
        if (focusable.length === 0) return;

        const activeEl = document.activeElement as HTMLElement;
        const currentIndex = focusable.indexOf(activeEl);

        if (e.shiftKey) {
          // Shift+Tab: go backwards
          e.preventDefault();
          const prevIndex =
            currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          // Tab: go forwards
          e.preventDefault();
          const nextIndex =
            currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
          focusable[nextIndex].focus();
        }
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, editorView, getFocusableElements]);

  // Don't render if not open
  if (!isOpen) return null;

  // Render mode-specific content
  const renderContent = () => {
    if (!editorView) return null;

    switch (mode) {
      case "format":
      case "list":       // TODO: Add list-specific actions (indent, outdent, toggle type)
      case "blockquote": // TODO: Add blockquote actions (increase/decrease level)
      case "math":       // TODO: Add math preview/edit toggle
      case "footnote":   // TODO: Add footnote navigation (go to definition)
        // Currently all show format buttons; context-specific actions coming later
        return (
          <FormatMode editorView={editorView} activeFormats={activeFormats} contextMode={contextMode} />
        );
      case "table":
        return tableInfo ? (
          <TableMode editorView={editorView} tableInfo={tableInfo} />
        ) : null;
      case "code":
        return codeFenceInfo ? (
          <CodeMode
            editorView={editorView}
            codeFenceInfo={codeFenceInfo}
            containerRef={containerRef}
          />
        ) : null;
      case "heading":
        return headingInfo ? (
          <HeadingMode editorView={editorView} headingInfo={headingInfo} />
        ) : null;
      default:
        return null;
    }
  };

  const popup = (
    <div
      ref={containerRef}
      className={`source-format-popup source-format-popup--${mode}`}
      style={{
        visibility: position ? "visible" : "hidden",
        top: position?.top ?? 0,
        left: position?.left ?? 0,
      }}
    >
      {renderContent()}
    </div>
  );

  return createPortal(popup, document.body);
}

export default SourceFormatPopup;
