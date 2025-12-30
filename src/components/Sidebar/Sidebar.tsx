import { useState, useMemo, useEffect, useRef } from "react";
import { ListTree, TableOfContents, History, RotateCcw } from "lucide-react";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useDocumentContent,
  useDocumentFilePath,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  getSnapshots,
  revertToSnapshot,
  type Snapshot,
} from "@/utils/historyUtils";
import { formatSnapshotTime, groupByDay } from "@/utils/dateUtils";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { FileExplorer } from "./FileExplorer";
import "./Sidebar.css";

interface HeadingItem {
  level: number;
  text: string;
  id: string;
}

function extractHeadings(content: string): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        id: `heading-${i}`,
      });
    }
  }

  return headings;
}

function FilesView() {
  const filePath = useDocumentFilePath();
  return <FileExplorer currentFilePath={filePath} />;
}

function OutlineView() {
  const content = useDocumentContent();
  const headings = useMemo(() => extractHeadings(content), [content]);

  return (
    <div className="sidebar-view">
      {headings.length > 0 ? (
        <ul className="outline-list">
          {headings.map((heading) => (
            <li
              key={heading.id}
              className={`outline-item outline-level-${heading.level}`}
            >
              {heading.text}
            </li>
          ))}
        </ul>
      ) : (
        <div className="sidebar-empty">No headings</div>
      )}
    </div>
  );
}


function HistoryView() {
  const filePath = useDocumentFilePath();
  const content = useDocumentContent();
  const { loadContent } = useDocumentActions();
  const historyEnabled = useSettingsStore((state) => state.general.historyEnabled);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const isRevertingRef = useRef(false);

  // Fetch snapshots when filePath changes (with cancellation)
  useEffect(() => {
    if (!filePath || !historyEnabled) {
      setSnapshots([]);
      return;
    }

    // Increment request ID to cancel stale requests
    const currentRequestId = ++requestIdRef.current;

    const fetchSnapshots = async () => {
      setLoading(true);
      try {
        const snaps = await getSnapshots(filePath);
        // Only update if this is still the current request
        if (currentRequestId === requestIdRef.current) {
          setSnapshots(snaps);
        }
      } catch (error) {
        if (currentRequestId === requestIdRef.current) {
          console.error("Failed to fetch snapshots:", error);
          setSnapshots([]);
        }
      } finally {
        if (currentRequestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    };

    fetchSnapshots();
  }, [filePath, historyEnabled]);

  const handleRevert = async (snapshot: Snapshot) => {
    if (!filePath) return;
    // Prevent re-entry (duplicate dialogs from rapid clicks)
    if (isRevertingRef.current) return;
    isRevertingRef.current = true;

    try {
      const confirmed = await ask(
        `Revert to version from ${formatSnapshotTime(snapshot.timestamp)}?\n\nYour current changes will be saved as a new history entry first.`,
        {
          title: "Revert to Earlier Version",
          kind: "warning",
        }
      );

      if (!confirmed) return;

      const { general } = useSettingsStore.getState();
      const restoredContent = await revertToSnapshot(
        filePath,
        snapshot.id,
        content,
        {
          maxSnapshots: general.historyMaxSnapshots,
          maxAgeDays: general.historyMaxAgeDays,
        }
      );

      if (restoredContent !== null) {
        // Write to file
        await writeTextFile(filePath, restoredContent);
        // Update editor
        loadContent(restoredContent, filePath);
        // Refresh snapshots
        const snaps = await getSnapshots(filePath);
        setSnapshots(snaps);
      }
    } catch (error) {
      console.error("Failed to revert:", error);
    } finally {
      isRevertingRef.current = false;
    }
  };

  if (!filePath) {
    return (
      <div className="sidebar-view">
        <div className="sidebar-empty">Save document to enable history</div>
      </div>
    );
  }

  if (!historyEnabled) {
    return (
      <div className="sidebar-view">
        <div className="sidebar-empty">History is disabled in settings</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="sidebar-view">
        <div className="sidebar-empty">Loading...</div>
      </div>
    );
  }

  if (snapshots.length === 0) {
    return (
      <div className="sidebar-view">
        <div className="sidebar-empty">No history yet</div>
      </div>
    );
  }

  const grouped = groupByDay(snapshots, (s) => s.timestamp);

  return (
    <div className="sidebar-view history-view">
      {Array.from(grouped.entries()).map(([day, daySnapshots]) => (
        <div key={day} className="history-group">
          <div className="history-day">{day}</div>
          {daySnapshots.map((snapshot) => (
            <div key={snapshot.id} className="history-item">
              <div className="history-item-info">
                <span className="history-time">
                  {new Date(snapshot.timestamp).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <span className="history-type">({snapshot.type})</span>
              </div>
              <button
                className="history-revert-btn"
                onClick={() => handleRevert(snapshot)}
                title="Revert to this version"
              >
                <RotateCcw size={12} />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function Sidebar() {
  const viewMode = useUIStore((state) => state.sidebarViewMode);

  const handleToggleView = () => {
    const { sidebarViewMode, setSidebarViewMode } = useUIStore.getState();
    // Cycle through: files -> outline -> history -> files
    if (sidebarViewMode === "files") setSidebarViewMode("outline");
    else if (sidebarViewMode === "outline") setSidebarViewMode("history");
    else setSidebarViewMode("files");
  };

  const getViewIcon = () => {
    switch (viewMode) {
      case "files":
        return <ListTree size={16} />;
      case "outline":
        return <TableOfContents size={16} />;
      case "history":
        return <History size={16} />;
    }
  };

  const getViewTitle = () => {
    switch (viewMode) {
      case "files":
        return "FILES";
      case "outline":
        return "OUTLINE";
      case "history":
        return "HISTORY";
    }
  };

  const getNextViewName = () => {
    switch (viewMode) {
      case "files":
        return "Outline";
      case "outline":
        return "History";
      case "history":
        return "Files";
    }
  };

  return (
    <div className="sidebar" style={{ width: "100%", height: "100%" }}>
      {/* Spacer for traffic lights area */}
      <div style={{ height: 38, flexShrink: 0 }} />
      <div className="sidebar-header">
        <button
          className="sidebar-btn"
          onClick={handleToggleView}
          title={`Show ${getNextViewName()}`}
        >
          {getViewIcon()}
        </button>
        <span className="sidebar-title">{getViewTitle()}</span>
      </div>

      <div className="sidebar-content">
        {viewMode === "files" && <FilesView />}
        {viewMode === "outline" && <OutlineView />}
        {viewMode === "history" && <HistoryView />}
      </div>
    </div>
  );
}

export default Sidebar;
