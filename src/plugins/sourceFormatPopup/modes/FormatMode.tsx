/**
 * Format Mode Component
 *
 * Renders format buttons for text selection formatting.
 */

import { useState } from "react";
import type { EditorView } from "@codemirror/view";
import { icons, createIcon } from "@/utils/icons";
import { applyFormat, type FormatType } from "../formatActions";
import { convertToHeading } from "../headingDetection";
import { toggleBlockquote, hasBlockquote } from "../blockquoteActions";
import { useSourceFormatStore } from "@/stores/sourceFormatStore";
import {
  TEXT_FORMAT_BUTTONS,
  LINK_BUTTONS,
  CODE_BUTTONS,
  HEADING_BUTTONS,
} from "../buttonDefs";

interface FormatModeProps {
  editorView: EditorView;
  activeFormats: Set<FormatType>;
}

export function FormatMode({ editorView, activeFormats }: FormatModeProps) {
  const [headingDropdownOpen, setHeadingDropdownOpen] = useState(false);

  const handleFormat = (type: FormatType) => {
    applyFormat(editorView, type);
    useSourceFormatStore.getState().closePopup();
  };

  const handleConvertToHeading = (level: number) => {
    convertToHeading(editorView, level);
    setHeadingDropdownOpen(false);
    useSourceFormatStore.getState().closePopup();
  };

  const handleBlockquote = () => {
    toggleBlockquote(editorView);
    useSourceFormatStore.getState().closePopup();
  };

  const isBlockquoteActive = hasBlockquote(editorView);

  return (
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
      <button
        type="button"
        className={`source-format-btn ${isBlockquoteActive ? "active" : ""}`}
        title="Blockquote"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleBlockquote}
      >
        {createIcon(icons.blockquote)}
      </button>
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
  );
}
