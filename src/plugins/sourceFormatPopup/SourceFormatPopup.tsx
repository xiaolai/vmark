/**
 * Source Format Popup Component
 *
 * Floating toolbar for markdown formatting and table editing in source mode.
 * Shows format buttons when text is selected, table buttons when in a table.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bold,
  Italic,
  Code,
  Strikethrough,
  Highlighter,
  Link,
  Image,
  Superscript,
  Subscript,
  Footprints,
  ArrowUpToLine,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  Trash2,
  TableCellsMerge,
  Columns2,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Pilcrow,
  ChevronDown,
  Heading,
} from "lucide-react";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import {
  calculatePopupPosition,
  getViewportBounds,
  type PopupPosition,
} from "@/utils/popupPosition";
import { applyFormat, hasFormat, type FormatType } from "./formatActions";
import {
  insertRowAbove,
  insertRowBelow,
  insertColumnLeft,
  insertColumnRight,
  deleteRow,
  deleteColumn,
  deleteTable,
} from "./tableDetection";
import { setHeadingLevel, convertToHeading } from "./headingDetection";
import "./source-format.css";

interface FormatButton {
  type: FormatType;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

const FORMAT_BUTTONS: FormatButton[] = [
  { type: "bold", icon: <Bold size={16} />, label: "Bold", shortcut: "⌘B" },
  { type: "italic", icon: <Italic size={16} />, label: "Italic", shortcut: "⌘I" },
  { type: "code", icon: <Code size={16} />, label: "Code", shortcut: "⌘E" },
  { type: "strikethrough", icon: <Strikethrough size={16} />, label: "Strikethrough", shortcut: "⌘⇧X" },
  { type: "highlight", icon: <Highlighter size={16} />, label: "Highlight", shortcut: "⌘⇧H" },
  { type: "superscript", icon: <Superscript size={16} />, label: "Superscript", shortcut: "⌘⇧." },
  { type: "subscript", icon: <Subscript size={16} />, label: "Subscript", shortcut: "⌘." },
  { type: "link", icon: <Link size={16} />, label: "Link", shortcut: "⌘K" },
  { type: "image", icon: <Image size={16} />, label: "Image", shortcut: "⌘⇧I" },
  { type: "footnote", icon: <Footprints size={16} />, label: "Footnote", shortcut: "⌘⇧F" },
];

interface TableButtonDef {
  id: string;
  icon: React.ReactNode;
  label: string;
  action: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "deleteRow" | "deleteCol" | "deleteTable";
  variant?: "danger";
}

const TABLE_BUTTONS: TableButtonDef[] = [
  { id: "rowAbove", icon: <ArrowUpToLine size={16} />, label: "Insert row above", action: "rowAbove" },
  { id: "rowBelow", icon: <ArrowDownToLine size={16} />, label: "Insert row below", action: "rowBelow" },
  { id: "colLeft", icon: <ArrowLeftToLine size={16} />, label: "Insert column left", action: "colLeft" },
  { id: "colRight", icon: <ArrowRightToLine size={16} />, label: "Insert column right", action: "colRight" },
  { id: "deleteRow", icon: <Columns2 size={16} />, label: "Delete row", action: "deleteRow" },
  { id: "deleteCol", icon: <TableCellsMerge size={16} />, label: "Delete column", action: "deleteCol" },
  { id: "deleteTable", icon: <Trash2 size={16} />, label: "Delete table", action: "deleteTable" },
];

interface HeadingButtonDef {
  level: number;
  icon: React.ReactNode;
  label: string;
}

const HEADING_BUTTONS: HeadingButtonDef[] = [
  { level: 1, icon: <Heading1 size={16} />, label: "Heading 1" },
  { level: 2, icon: <Heading2 size={16} />, label: "Heading 2" },
  { level: 3, icon: <Heading3 size={16} />, label: "Heading 3" },
  { level: 4, icon: <Heading4 size={16} />, label: "Heading 4" },
  { level: 5, icon: <Heading5 size={16} />, label: "Heading 5" },
  { level: 6, icon: <Heading6 size={16} />, label: "Heading 6" },
  { level: 0, icon: <Pilcrow size={16} />, label: "Paragraph" },
];

export function SourceFormatPopup() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const [activeFormats, setActiveFormats] = useState<Set<FormatType>>(new Set());
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);
  const justOpenedRef = useRef(false);

  const isOpen = useSourceFormatStore((state) => state.isOpen);
  const mode = useSourceFormatStore((state) => state.mode);
  const anchorRect = useSourceFormatStore((state) => state.anchorRect);
  const editorView = useSourceFormatStore((state) => state.editorView);
  const tableInfo = useSourceFormatStore((state) => state.tableInfo);
  const headingInfo = useSourceFormatStore((state) => state.headingInfo);

  // Calculate position when popup opens or anchor changes
  useEffect(() => {
    if (!isOpen || !anchorRect || !containerRef.current) {
      setPosition(null);
      return;
    }

    // Measure popup dimensions
    const popup = containerRef.current;
    const width = popup.offsetWidth || 200;
    const height = popup.offsetHeight || 36;

    // Calculate position
    const bounds = getViewportBounds();
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
  }, [isOpen, anchorRect, mode]);

  // Update active formats when editor view changes (only in format mode)
  useEffect(() => {
    if (!isOpen || !editorView || mode !== "format") {
      setActiveFormats(new Set());
      return;
    }

    const formats = new Set<FormatType>();
    FORMAT_BUTTONS.forEach(({ type }) => {
      if (hasFormat(editorView, type)) {
        formats.add(type);
      }
    });
    setActiveFormats(formats);
  }, [isOpen, editorView, mode]);

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
      if (e.key === "Escape") {
        useSourceFormatStore.getState().closePopup();
        editorView?.focus();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, editorView]);

  const handleFormat = useCallback(
    (type: FormatType) => {
      if (!editorView) return;

      applyFormat(editorView, type);

      // Close popup after formatting (selection changes)
      useSourceFormatStore.getState().closePopup();
    },
    [editorView]
  );

  const handleTableAction = useCallback(
    (action: TableButtonDef["action"]) => {
      if (!editorView || !tableInfo) return;

      // Re-fetch table info to ensure it's current
      const info = tableInfo;

      switch (action) {
        case "rowAbove":
          insertRowAbove(editorView, info);
          break;
        case "rowBelow":
          insertRowBelow(editorView, info);
          break;
        case "colLeft":
          insertColumnLeft(editorView, info);
          break;
        case "colRight":
          insertColumnRight(editorView, info);
          break;
        case "deleteRow":
          deleteRow(editorView, info);
          break;
        case "deleteCol":
          deleteColumn(editorView, info);
          break;
        case "deleteTable":
          deleteTable(editorView, info);
          useSourceFormatStore.getState().closePopup();
          break;
      }
    },
    [editorView, tableInfo]
  );

  const handleHeadingLevel = useCallback(
    (level: number) => {
      if (!editorView || !headingInfo) return;

      setHeadingLevel(editorView, headingInfo, level);
      useSourceFormatStore.getState().closePopup();
    },
    [editorView, headingInfo]
  );

  const handleConvertToHeading = useCallback(
    (level: number) => {
      if (!editorView) return;

      convertToHeading(editorView, level);
      setHeadingDropdownOpen(false);
      useSourceFormatStore.getState().closePopup();
    },
    [editorView]
  );

  // Close dropdown when popup closes
  useEffect(() => {
    if (!isOpen) {
      setHeadingDropdownOpen(false);
    }
  }, [isOpen]);

  // Don't render if not open
  if (!isOpen) return null;

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
      {mode === "format" ? (
        // Format buttons for text selection
        <>
          {FORMAT_BUTTONS.map(({ type, icon, label, shortcut }) => (
            <button
              key={type}
              type="button"
              className={`source-format-btn ${activeFormats.has(type) ? "active" : ""}`}
              title={`${label} (${shortcut})`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleFormat(type)}
            >
              {icon}
            </button>
          ))}
          <div className="source-format-separator" />
          <div className="source-format-dropdown">
            <button
              type="button"
              className={`source-format-btn source-format-dropdown-trigger ${headingDropdownOpen ? "active" : ""}`}
              title="Heading"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHeadingDropdownOpen(!headingDropdownOpen)}
            >
              <Heading size={16} />
              <ChevronDown size={12} />
            </button>
            {headingDropdownOpen && (
              <div className="source-format-dropdown-menu">
                {HEADING_BUTTONS.slice(0, 6).map(({ level, icon, label }) => (
                  <button
                    key={level}
                    type="button"
                    className="source-format-dropdown-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleConvertToHeading(level)}
                  >
                    {icon}
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      ) : mode === "table" ? (
        // Table buttons when cursor is in table
        TABLE_BUTTONS.map(({ id, icon, label, action, variant }) => (
          <button
            key={id}
            type="button"
            className={`source-format-btn ${variant === "danger" ? "danger" : ""}`}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleTableAction(action)}
          >
            {icon}
          </button>
        ))
      ) : (
        // Heading buttons when selection is in a heading
        HEADING_BUTTONS.map(({ level, icon, label }) => (
          <button
            key={level}
            type="button"
            className={`source-format-btn ${headingInfo?.level === level ? "active" : ""}`}
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleHeadingLevel(level)}
          >
            {icon}
          </button>
        ))
      )}
    </div>
  );

  return createPortal(popup, document.body);
}

export default SourceFormatPopup;
