/**
 * Purpose: StatusBar button + popover that surfaces the MCP checkpoint
 *   history for the active tab. Each row lists when an AI write
 *   happened, which tool produced it, and a one-click restore.
 *
 *   Replaces the safety net the deleted suggestions feature used to
 *   provide. Filed under StatusBar because that's where the MCP
 *   connection indicator already lives.
 *
 * Key decisions:
 *   - Filter checkpoints by the currently focused tab. Cross-tab view
 *     is interesting but noisy; users wanting it can reach the store
 *     programmatically.
 *   - Restore via setContent + revisionStore.updateRevision so every
 *     concurrent MCP client sees a STALE on its next write — exactly
 *     the same conflict semantic as a manual edit.
 *   - The popover uses position: fixed and the shared popup CSS tokens.
 *
 * @coordinates-with stores/mcpCheckpointStore.ts — checkpoint state
 * @coordinates-with stores/mcpCheckpointPersistence.ts — disk rewrite on restore
 * @coordinates-with stores/documentStore.ts — setContent for restore
 * @coordinates-with stores/revisionStore.ts — bump on restore
 * @module components/McpHistory/McpHistoryButton
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { History, Undo2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMcpCheckpointStore } from "@/stores/mcpCheckpointStore";
import type { MCPCheckpoint } from "@/stores/mcpCheckpointStore";
import { rewriteAll } from "@/stores/mcpCheckpointPersistence";
import { useDocumentStore } from "@/stores/documentStore";
import { useRevisionStore } from "@/stores/revisionStore";
import { useTabStore } from "@/stores/tabStore";
import { getCurrentWindowLabel } from "@/utils/workspaceStorage";
import { imeToast as toast } from "@/utils/imeToast";
import "./mcp-history.css";

const POPUP_WIDTH = 360;
const POPUP_MAX_HEIGHT = 420;

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

interface RestoreContext {
  tabId: string;
  cp: MCPCheckpoint;
}

/**
 * Apply a checkpoint's `contentBefore` to its tab and bump the
 * revision so concurrent MCP callers see STALE on next write.
 *
 * Returns true when the restore actually mutated the doc.
 */
function applyRestore({ tabId, cp }: RestoreContext): boolean {
  const docStore = useDocumentStore.getState();
  const doc = docStore.documents[tabId];
  if (!doc) return false;
  if (doc.content === cp.contentBefore) return false;
  docStore.setContent(tabId, cp.contentBefore);
  useRevisionStore.getState().updateRevision();
  return true;
}

export function McpHistoryButton(): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Subscribe to the store so the badge count updates live.
  const checkpoints = useMcpCheckpointStore((s) => s.checkpoints);

  const tabId = useTabStore((s) => s.activeTabId[getCurrentWindowLabel()]);
  const tabFilePath = useDocumentStore((s) =>
    tabId ? s.documents[tabId]?.filePath ?? null : null,
  );

  const visible: MCPCheckpoint[] = checkpoints.filter((cp) => {
    if (tabFilePath !== null) return cp.filePath === tabFilePath;
    return cp.tabId === tabId;
  });
  const count = visible.length;

  // Close on outside click / escape.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (buttonRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const onRestore = useCallback(
    async (cp: MCPCheckpoint) => {
      if (!tabId) return;
      const ok = applyRestore({ tabId, cp });
      if (ok) {
        toast.success(t("mcpHistoryRestored", { tool: cp.tool }));
      } else {
        toast.error(t("mcpHistoryRestoreNoop"));
      }
      setOpen(false);
    },
    [tabId, t],
  );

  const onClear = useCallback(async () => {
    const filter =
      tabFilePath !== null
        ? { filePath: tabFilePath }
        : tabId
          ? { tabId }
          : undefined;
    if (!filter) return;
    useMcpCheckpointStore.getState().clear(filter);
    void rewriteAll();
    toast.success(t("mcpHistoryCleared"));
  }, [tabId, tabFilePath, t]);

  const popoverPosition = (): React.CSSProperties => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return { display: "none" };
    const right = Math.max(8, window.innerWidth - rect.right);
    const bottom = Math.max(8, window.innerHeight - rect.top + 6);
    return {
      right,
      bottom,
      width: POPUP_WIDTH,
      maxHeight: POPUP_MAX_HEIGHT,
    };
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`status-mcp-history ${count > 0 ? "has-history" : ""}`}
        onClick={() => setOpen((v) => !v)}
        title={t("mcpHistoryTitle", { count })}
        aria-label={t("mcpHistoryTitle", { count })}
        aria-expanded={open}
      >
        <History size={12} />
        {count > 0 && (
          <span className="status-mcp-history__badge">{count}</span>
        )}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="mcp-history-popover"
          style={popoverPosition()}
          role="dialog"
          aria-label={t("mcpHistoryTitle", { count })}
        >
          <header className="mcp-history-popover__header">
            <span className="mcp-history-popover__title">
              {t("mcpHistoryTitle", { count })}
            </span>
            <button
              type="button"
              className="mcp-history-popover__clear"
              onClick={onClear}
              disabled={visible.length === 0}
              title={t("mcpHistoryClear")}
            >
              <Trash2 size={14} />
            </button>
          </header>
          <div className="mcp-history-popover__list">
            {visible.length === 0 ? (
              <div className="mcp-history-popover__empty">
                {t("mcpHistoryEmpty")}
              </div>
            ) : (
              visible.map((cp) => (
                <article
                  key={cp.id}
                  className="mcp-history-popover__row"
                >
                  <div className="mcp-history-popover__row-meta">
                    <time className="mcp-history-popover__time">
                      {formatTime(cp.timestamp)}
                    </time>
                    <code className="mcp-history-popover__tool">
                      {cp.tool}
                    </code>
                  </div>
                  <div className="mcp-history-popover__description">
                    {cp.description}
                  </div>
                  <button
                    type="button"
                    className="mcp-history-popover__restore"
                    onClick={() => void onRestore(cp)}
                    title={t("mcpHistoryRestore")}
                    aria-label={t("mcpHistoryRestore")}
                  >
                    <Undo2 size={14} />
                  </button>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
