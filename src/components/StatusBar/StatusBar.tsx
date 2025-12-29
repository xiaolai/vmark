import { useMemo, useState, useEffect } from "react";
import { Code2, Type, PanelLeft, Save } from "lucide-react";
import { useEditorStore } from "@/stores/editorStore";
import { useUIStore } from "@/stores/uiStore";
import { formatRelativeTime, formatExactTime } from "@/utils/dateUtils";
import "./StatusBar.css";

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

function countCharacters(text: string): number {
  return text.length;
}

export function StatusBar() {
  const content = useEditorStore((state) => state.content);
  const filePath = useEditorStore((state) => state.filePath);
  const isDirty = useEditorStore((state) => state.isDirty);
  const sourceMode = useEditorStore((state) => state.sourceMode);
  const lastAutoSave = useEditorStore((state) => state.lastAutoSave);
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
  const fileName = filePath ? filePath.split("/").pop() : "Untitled";

  return (
    <div className="status-bar-container">
      <div className="status-bar">
        <div className="status-bar-left">
          <button
            className={`status-toggle ${sidebarVisible ? "active" : ""}`}
            title="Toggle Sidebar"
            onClick={() => useUIStore.getState().toggleSidebar()}
          >
            <PanelLeft size={14} />
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
