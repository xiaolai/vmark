/**
 * Heading Mode Component
 *
 * Renders heading level buttons when cursor is in a heading.
 */

import type { EditorView } from "@codemirror/view";
import { useSourceFormatStore, type HeadingInfo } from "@/stores/sourceFormatStore";
import { setHeadingLevel } from "../headingDetection";
import { HEADING_BUTTONS } from "../buttonDefs";

interface HeadingModeProps {
  editorView: EditorView;
  headingInfo: HeadingInfo;
}

export function HeadingMode({ editorView, headingInfo }: HeadingModeProps) {
  const handleHeadingLevel = (level: number) => {
    setHeadingLevel(editorView, headingInfo, level);
    const store = useSourceFormatStore.getState();
    store.clearOriginalCursor();
    store.closePopup();
  };

  return (
    <>
      {HEADING_BUTTONS.map(({ level, icon, label }) => (
        <button
          key={level}
          type="button"
          className={`source-format-btn ${headingInfo.level === level ? "active" : ""}`}
          title={label}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => handleHeadingLevel(level)}
        >
          {icon}
        </button>
      ))}
    </>
  );
}
