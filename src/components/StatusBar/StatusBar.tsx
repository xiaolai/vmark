import { useMemo, useState, useEffect } from "react";
import { Code2, Type, PanelLeftOpen, PanelRightOpen, Save } from "lucide-react";
import { countWords as alfaazCount } from "alfaaz";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import {
  useDocumentContent,
  useDocumentFilePath,
  useDocumentIsDirty,
  useDocumentLastAutoSave,
} from "@/hooks/useDocumentState";
import { formatRelativeTime, formatExactTime } from "@/utils/dateUtils";
import { getFileName } from "@/utils/pathUtils";
import "./StatusBar.css";

/**
 * Strip markdown formatting to get plain text for word counting.
 * Removes: headers, bold/italic, links, images, code blocks, blockquotes, lists
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove code blocks (``` ... ```)
      .replace(/```[\s\S]*?```/g, "")
      // Remove inline code (` ... `)
      .replace(/`[^`]+`/g, "")
      // Remove images ![alt](url)
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      // Convert links [text](url) to just text
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // Remove headers (# ## ### etc.)
      .replace(/^#{1,6}\s+/gm, "")
      // Remove bold/italic markers
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      // Remove blockquotes
      .replace(/^>\s+/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove list markers
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Clean up extra whitespace
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Count words using alfaaz (supports CJK - counts each CJK char as a word)
 */
function countWords(text: string): number {
  const plainText = stripMarkdown(text);
  return alfaazCount(plainText);
}

/**
 * Count characters (excluding markdown formatting)
 */
function countCharacters(text: string): number {
  const plainText = stripMarkdown(text);
  // Exclude whitespace for character count
  return plainText.replace(/\s/g, "").length;
}

export function StatusBar() {
  const content = useDocumentContent();
  const filePath = useDocumentFilePath();
  const isDirty = useDocumentIsDirty();
  const lastAutoSave = useDocumentLastAutoSave();
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const sidebarVisible = useUIStore((state) => state.sidebarVisible);

  const [showAutoSave, setShowAutoSave] = useState(false);
  const [autoSaveTime, setAutoSaveTime] = useState<string>("");

  // Show auto-save indicator when lastAutoSave changes
  useEffect(() => {
    if (!lastAutoSave) return;

    setAutoSaveTime(formatRelativeTime(lastAutoSave));
    setShowAutoSave(true);

    // Update the relative time every 10 seconds
    const updateInterval = setInterval(() => {
      setAutoSaveTime(formatRelativeTime(lastAutoSave));
    }, 10000);

    // Fade out after 5 seconds
    const fadeTimeout = setTimeout(() => {
      setShowAutoSave(false);
    }, 5000);

    return () => {
      clearInterval(updateInterval);
      clearTimeout(fadeTimeout);
    };
  }, [lastAutoSave]);

  const wordCount = useMemo(() => countWords(content), [content]);
  const charCount = useMemo(() => countCharacters(content), [content]);
  const fileName = filePath ? getFileName(filePath) : "Untitled";

  return (
    <div className="status-bar-container">
      <div className="status-bar">
        <div className="status-bar-left">
          <button
            className={`status-toggle ${sidebarVisible ? "active" : ""}`}
            title="Toggle Sidebar"
            onClick={() => useUIStore.getState().toggleSidebar()}
          >
            {sidebarVisible ? <PanelRightOpen size={14} /> : <PanelLeftOpen size={14} />}
          </button>
          <span className="status-file">
            {isDirty && <span className="status-dirty-indicator" />}
            {fileName}
          </span>
        </div>
        <div className="status-bar-right">
          {showAutoSave && lastAutoSave && (
            <span
              className="status-autosave"
              title={`Auto-saved at ${formatExactTime(lastAutoSave)}`}
            >
              <Save size={12} />
              {autoSaveTime}
            </span>
          )}
          <span className="status-item">{wordCount} words</span>
          <span className="status-item">{charCount} characters</span>
          <button
            className="status-mode"
            title={sourceMode ? "Source Mode (F7)" : "Rich Text Mode (F7)"}
            onClick={() => useEditorStore.getState().toggleSourceMode()}
          >
            {sourceMode ? <Code2 size={14} /> : <Type size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
}

export default StatusBar;
