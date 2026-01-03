/**
 * Source Format Popup Component
 *
 * Floating toolbar for markdown formatting and table editing in source mode.
 * Shows format buttons when text is selected, table buttons when in a table.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import { icons, createIcon } from "@/utils/icons";
import {
  calculatePopupPosition,
  getBoundaryRects,
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
  setColumnAlignment,
  setAllColumnsAlignment,
  getColumnAlignment,
  formatTable,
  type TableAlignment,
} from "./tableDetection";
import { setHeadingLevel, convertToHeading } from "./headingDetection";
import { setCodeFenceLanguage } from "./codeFenceActions";
import {
  QUICK_LANGUAGES,
  getQuickLabel,
  filterLanguages,
  getRecentLanguages,
} from "./languages";
import "./source-format.css";

interface FormatButton {
  type: FormatType;
  icon: React.ReactNode;
  label: string;
  shortcut: string;
}

// Format button groups: headings | bold italic strike highlight | link image | sup sub code
const TEXT_FORMAT_BUTTONS: FormatButton[] = [
  { type: "bold", icon: createIcon(icons.bold), label: "Bold", shortcut: "⌘B" },
  { type: "italic", icon: createIcon(icons.italic), label: "Italic", shortcut: "⌘I" },
  { type: "strikethrough", icon: createIcon(icons.strikethrough), label: "Strikethrough", shortcut: "⌘⇧X" },
  { type: "highlight", icon: createIcon(icons.highlight), label: "Highlight", shortcut: "⌘⇧H" },
];

const LINK_BUTTONS: FormatButton[] = [
  { type: "link", icon: createIcon(icons.link), label: "Link", shortcut: "⌘K" },
  { type: "image", icon: createIcon(icons.image), label: "Image", shortcut: "⌘⇧I" },
];

const CODE_BUTTONS: FormatButton[] = [
  { type: "superscript", icon: createIcon(icons.superscript), label: "Superscript", shortcut: "⌘⇧." },
  { type: "subscript", icon: createIcon(icons.subscript), label: "Subscript", shortcut: "⌘." },
  { type: "code", icon: createIcon(icons.inlineCode), label: "Code", shortcut: "⌘`" },
];

// Combined for active format detection
const ALL_FORMAT_BUTTONS = [...TEXT_FORMAT_BUTTONS, ...LINK_BUTTONS, ...CODE_BUTTONS];

interface TableButtonDef {
  id: string;
  icon: React.ReactNode;
  label: string;
  action: "rowAbove" | "rowBelow" | "colLeft" | "colRight" | "deleteRow" | "deleteCol" | "deleteTable" | "separator";
  variant?: "danger";
}

const TABLE_BUTTONS: TableButtonDef[] = [
  { id: "rowAbove", icon: createIcon(icons.rowAbove), label: "Insert row above", action: "rowAbove" },
  { id: "rowBelow", icon: createIcon(icons.rowBelow), label: "Insert row below", action: "rowBelow" },
  { id: "colLeft", icon: createIcon(icons.colLeft), label: "Insert column left", action: "colLeft" },
  { id: "colRight", icon: createIcon(icons.colRight), label: "Insert column right", action: "colRight" },
  { id: "sep1", icon: null, label: "", action: "separator" },
  { id: "deleteRow", icon: createIcon(icons.deleteRow), label: "Delete row", action: "deleteRow" },
  { id: "deleteCol", icon: createIcon(icons.deleteCol), label: "Delete column", action: "deleteCol" },
  { id: "deleteTable", icon: createIcon(icons.deleteTable), label: "Delete table", action: "deleteTable" },
];

interface AlignButtonDef {
  id: string;
  icon: React.ReactNode;
  label: string;
  alignment: TableAlignment;
}

const ALIGN_BUTTONS: AlignButtonDef[] = [
  { id: "alignLeft", icon: createIcon(icons.alignLeft), label: "Align column left", alignment: "left" },
  { id: "alignCenter", icon: createIcon(icons.alignCenter), label: "Align column center", alignment: "center" },
  { id: "alignRight", icon: createIcon(icons.alignRight), label: "Align column right", alignment: "right" },
];

const ALIGN_ALL_BUTTONS: AlignButtonDef[] = [
  { id: "alignAllLeft", icon: createIcon(icons.alignAllLeft), label: "Align all left", alignment: "left" },
  { id: "alignAllCenter", icon: createIcon(icons.alignAllCenter), label: "Align all center", alignment: "center" },
  { id: "alignAllRight", icon: createIcon(icons.alignAllRight), label: "Align all right", alignment: "right" },
];

interface HeadingButtonDef {
  level: number;
  icon: React.ReactNode;
  label: string;
}

const HEADING_BUTTONS: HeadingButtonDef[] = [
  { level: 1, icon: createIcon(icons.heading1), label: "Heading 1" },
  { level: 2, icon: createIcon(icons.heading2), label: "Heading 2" },
  { level: 3, icon: createIcon(icons.heading3), label: "Heading 3" },
  { level: 4, icon: createIcon(icons.heading4), label: "Heading 4" },
  { level: 5, icon: createIcon(icons.heading5), label: "Heading 5" },
  { level: 6, icon: createIcon(icons.heading6), label: "Heading 6" },
  { level: 0, icon: createIcon(icons.paragraph), label: "Paragraph" },
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
  const codeFenceInfo = useSourceFormatStore((state) => state.codeFenceInfo);

  // Code mode state
  const [languageSearch, setLanguageSearch] = useState("");
  const [languageDropdownOpen, setLanguageDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

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
  }, [isOpen, anchorRect, mode, editorView]);

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
          const prevIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1;
          focusable[prevIndex].focus();
        } else {
          // Tab: go forwards
          e.preventDefault();
          const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1;
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

  const handleAlignment = useCallback(
    (alignment: TableAlignment) => {
      if (!editorView || !tableInfo) return;
      setColumnAlignment(editorView, tableInfo, alignment);
    },
    [editorView, tableInfo]
  );

  const handleAlignAll = useCallback(
    (alignment: TableAlignment) => {
      if (!editorView || !tableInfo) return;
      setAllColumnsAlignment(editorView, tableInfo, alignment);
    },
    [editorView, tableInfo]
  );

  const handleFormatTable = useCallback(() => {
    if (!editorView || !tableInfo) return;
    formatTable(editorView, tableInfo);
  }, [editorView, tableInfo]);

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

  const handleLanguageSelect = useCallback(
    (language: string) => {
      if (!editorView || !codeFenceInfo) return;

      setCodeFenceLanguage(editorView, codeFenceInfo, language);
      setLanguageDropdownOpen(false);
      setLanguageSearch("");
      useSourceFormatStore.getState().closePopup();
      editorView.focus();
    },
    [editorView, codeFenceInfo]
  );

  // Close dropdown when popup closes
  useEffect(() => {
    if (!isOpen) {
      setHeadingDropdownOpen(false);
      setLanguageDropdownOpen(false);
      setLanguageSearch("");
    }
  }, [isOpen]);

  // Focus search input when language dropdown opens
  useEffect(() => {
    if (languageDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [languageDropdownOpen]);

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
        // Format buttons: headings | bold italic strike highlight | link image | sup sub code
        <>
          <div className="source-format-dropdown">
            <button
              type="button"
              className={`source-format-btn source-format-dropdown-trigger ${headingDropdownOpen ? "active" : ""}`}
              title="Heading"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setHeadingDropdownOpen(!headingDropdownOpen)}
            >
              {createIcon(icons.heading)}
              {createIcon(icons.chevronDown, 12)}
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
          <div className="source-format-separator" />
          {TEXT_FORMAT_BUTTONS.map(({ type, icon, label, shortcut }) => (
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
          {LINK_BUTTONS.map(({ type, icon, label, shortcut }) => (
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
          {CODE_BUTTONS.map(({ type, icon, label, shortcut }) => (
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
        </>
      ) : mode === "table" ? (
        // Table buttons when cursor is in table (two rows)
        <div className="source-format-table-grid">
          <div className="source-format-row">
            {TABLE_BUTTONS.map(({ id, icon, label, action }) =>
              action === "separator" ? (
                <div key={id} className="source-format-separator" />
              ) : (
                <button
                  key={id}
                  type="button"
                  className="source-format-btn"
                  title={label}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleTableAction(action)}
                >
                  {icon}
                </button>
              )
            )}
          </div>
          <div className="source-format-row">
            {ALIGN_BUTTONS.map(({ id, icon, label, alignment }) => (
              <button
                key={id}
                type="button"
                className={`source-format-btn ${tableInfo && getColumnAlignment(tableInfo) === alignment ? "active" : ""}`}
                title={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAlignment(alignment)}
              >
                {icon}
              </button>
            ))}
            <div className="source-format-separator" />
            {ALIGN_ALL_BUTTONS.map(({ id, icon, label, alignment }) => (
              <button
                key={id}
                type="button"
                className="source-format-btn"
                title={label}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleAlignAll(alignment)}
              >
                {icon}
              </button>
            ))}
            <div className="source-format-separator" />
            <button
              type="button"
              className="source-format-btn"
              title="Format table (space-padded)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleFormatTable}
            >
              {createIcon(icons.formatTable)}
            </button>
          </div>
        </div>
      ) : mode === "code" ? (
        // Language picker for code fence
        (() => {
          const recentLangs = getRecentLanguages();
          const quickLangs = recentLangs.length > 0
            ? recentLangs.slice(0, 5)
            : QUICK_LANGUAGES.map(l => l.name);
          return (
        <>
          <div className="source-format-quick-langs">
            {quickLangs.map((name) => (
              <button
                key={name}
                type="button"
                className={`source-format-quick-btn ${codeFenceInfo?.language === name ? "active" : ""}`}
                title={name}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleLanguageSelect(name)}
              >
                {getQuickLabel(name)}
              </button>
            ))}
          </div>
          <div className="source-format-separator" />
          <div className="source-format-dropdown source-format-lang-dropdown">
            <button
              type="button"
              className={`source-format-btn source-format-dropdown-trigger ${languageDropdownOpen ? "active" : ""}`}
              title="Select language"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setLanguageDropdownOpen(!languageDropdownOpen)}
            >
              <span className="source-format-lang-label">
                {codeFenceInfo?.language || "plain"}
              </span>
              {createIcon(icons.chevronDown, 12)}
            </button>
            {languageDropdownOpen && (
              <div className="source-format-lang-menu">
                <div className="source-format-lang-search">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search..."
                    value={languageSearch}
                    onChange={(e) => setLanguageSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setLanguageDropdownOpen(false);
                        editorView?.focus();
                      } else if (e.key === "Enter") {
                        const filtered = filterLanguages(languageSearch);
                        if (filtered.length > 0) {
                          handleLanguageSelect(filtered[0].name);
                        }
                      }
                    }}
                  />
                </div>
                <div className="source-format-lang-section">
                  <div className="source-format-lang-list">
                    {filterLanguages(languageSearch).map(({ name }) => (
                      <button
                        key={name}
                        type="button"
                        className={`source-format-lang-item ${codeFenceInfo?.language === name ? "active" : ""}`}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleLanguageSelect(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
          );
        })()
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
