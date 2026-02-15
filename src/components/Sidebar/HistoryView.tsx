/**
 * History View Component
 *
 * Displays document version history with revert functionality.
 */

import { useState, useEffect, useRef } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useSettingsStore } from "@/stores/settingsStore";
import {
  useDocumentFilePath,
  useDocumentActions,
} from "@/hooks/useDocumentState";
import {
  getSnapshots,
  revertToSnapshot,
  deleteSnapshot,
  type Snapshot,
} from "@/hooks/useHistoryOperations";
import { buildHistorySettings, HISTORY_CLEARED_EVENT } from "@/utils/historyTypes";
import { formatSnapshotTime, groupByDay } from "@/utils/dateUtils";

export function HistoryView() {
  const filePath = useDocumentFilePath();
  const { getContent, loadContent } = useDocumentActions();
  const historyEnabled = useSettingsStore((state) => state.general.historyEnabled);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const requestIdRef = useRef(0);
  const isMutatingRef = useRef(false);

  // Fetch snapshots when filePath changes (with cancellation)
  useEffect(() => {
    // Always increment to cancel any in-flight request
    const currentRequestId = ++requestIdRef.current;

    if (!filePath || !historyEnabled) {
      setSnapshots([]);
      return;
    }

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
  }, [filePath, historyEnabled, refreshKey]);

  // Listen for external clear events (menu actions)
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener(HISTORY_CLEARED_EVENT, handler);
    return () => window.removeEventListener(HISTORY_CLEARED_EVENT, handler);
  }, []);

  const handleDeleteSnapshot = async (snapshot: Snapshot) => {
    if (!filePath || isMutatingRef.current) return;
    isMutatingRef.current = true;
    try {
      await deleteSnapshot(filePath, snapshot.id);
      setRefreshKey((k) => k + 1);
    } catch (error) {
      console.error("Failed to delete snapshot:", error);
    } finally {
      isMutatingRef.current = false;
    }
  };

  const handleRevert = async (snapshot: Snapshot) => {
    if (!filePath || isMutatingRef.current) return;
    isMutatingRef.current = true;

    try {
      const confirmed = await ask(
        `Revert to version from ${formatSnapshotTime(snapshot.timestamp)}?\n\nYour current changes will be saved as a new history entry first.`,
        {
          title: "Revert to Earlier Version",
          kind: "warning",
        }
      );

      if (!confirmed) return;

      // Get fresh content to capture any edits made while dialog was open
      const currentContent = getContent();
      const { general } = useSettingsStore.getState();
      const restoredContent = await revertToSnapshot(
        filePath,
        snapshot.id,
        currentContent,
        buildHistorySettings(general)
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
      isMutatingRef.current = false;
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
              <div className="history-item-actions">
                <button
                  className="history-revert-btn"
                  onClick={() => handleRevert(snapshot)}
                  title="Revert to this version"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  className="history-delete-btn"
                  onClick={() => handleDeleteSnapshot(snapshot)}
                  title="Delete this snapshot"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
