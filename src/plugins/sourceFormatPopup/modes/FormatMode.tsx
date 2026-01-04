/**
 * Format Mode Component
 *
 * Renders context-aware buttons based on cursor position:
 * - format: text formatting buttons (bold, italic, etc.)
 * - inline-insert: inline element insert buttons (image, math, footnote)
 * - block-insert: block element insert buttons (list, blockquote, table, etc.)
 */

import type { EditorView } from "@codemirror/view";
import { applyFormat, type FormatType } from "../formatActions";
import { useSourceFormatStore, type ContextMode } from "@/stores/sourceFormatStore";
import {
  TEXT_FORMAT_BUTTONS,
  INLINE_INSERT_BUTTONS,
  BLOCK_INSERT_BUTTONS,
  type InsertType,
} from "../buttonDefs";

interface FormatModeProps {
  editorView: EditorView;
  activeFormats: Set<FormatType>;
  contextMode: ContextMode;
}

export function FormatMode({ editorView, activeFormats, contextMode }: FormatModeProps) {
  const handleFormat = (type: FormatType) => {
    applyFormat(editorView, type);
    const store = useSourceFormatStore.getState();
    store.clearOriginalCursor();
    store.closePopup();
  };

  const handleInsert = (type: InsertType) => {
    const { from } = editorView.state.selection.main;
    let textToInsert = "";

    switch (type) {
      // Inline inserts
      case "inline-image":
        textToInsert = "![](url)";
        break;
      case "inline-math":
        textToInsert = "$formula$";
        break;
      case "footnote":
        textToInsert = "[^1]";
        break;
      // Block inserts
      case "block-image":
        textToInsert = "![](url)\n";
        break;
      case "ordered-list":
        textToInsert = "1. ";
        break;
      case "unordered-list":
        textToInsert = "- ";
        break;
      case "blockquote":
        textToInsert = "> ";
        break;
      case "table":
        textToInsert = "| Header 1 | Header 2 |\n| --- | --- |\n| Cell 1 | Cell 2 |\n";
        break;
      case "divider":
        textToInsert = "---\n";
        break;
      default:
        return;
    }

    editorView.dispatch({
      changes: { from, to: from, insert: textToInsert },
    });
    editorView.focus();
    const store = useSourceFormatStore.getState();
    store.clearOriginalCursor();
    store.closePopup();
  };

  // Render inline insert buttons
  if (contextMode === "inline-insert") {
    return (
      <>
        {INLINE_INSERT_BUTTONS.map(({ type, icon, label }) => (
          <button
            key={type}
            type="button"
            className="source-format-btn"
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleInsert(type)}
          >
            {icon}
          </button>
        ))}
      </>
    );
  }

  // Render block insert buttons
  if (contextMode === "block-insert") {
    return (
      <>
        {BLOCK_INSERT_BUTTONS.map(({ type, icon, label }) => (
          <button
            key={type}
            type="button"
            className="source-format-btn"
            title={label}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleInsert(type)}
          >
            {icon}
          </button>
        ))}
      </>
    );
  }

  // Default: format buttons
  return (
    <>
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
    </>
  );
}
