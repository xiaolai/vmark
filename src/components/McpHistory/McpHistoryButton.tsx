/**
 * Purpose: StatusBar button + popover for the agent edit history of the
 *   focused document: whether its changes are being recorded, its
 *   unrecorded writes, its revisions with who made each one, and the
 *   global list of earlier checkpoints.
 *
 *   Filed under StatusBar because that's where the MCP connection
 *   indicator already lives.
 *
 * Key decisions:
 *   - Everything is read from the agent edit journal under the document's
 *     key (`docKeyFor`: path key for a saved file, tab key for an untitled
 *     tab) and re-read after every journal change in any window (the
 *     generation broadcast), so windows showing one document converge.
 *   - The history and health feeds run while the button is mounted, not
 *     only while the popover is open: the badge (agent revisions) and the
 *     attention state must be current without opening it.
 *   - Without live updates (still starting, or their forwarder failed) every
 *     feed in the panel polls (`FEED_POLL_MS`): health, history, uncommitted
 *     entries and earlier checkpoints, so another window's change still arrives;
 *     a journal that never started, or live updates that are ready, poll
 *     nothing.
 *   - Attention means the status notice has something to say
 *     (`journalStatusLines`): a failed, read-only or behind journal, a
 *     queued or refused record of this document, recording suspended
 *     because its identity could not be updated, or a blocked revert.
 *   - A history read that fails after a good one shows none of the old
 *     value — not in the badge, the status or the revisions — so a stale
 *     revision is never offered for restore (as in EarlierCheckpoints).
 *   - The review panel (keep, revert, Clear reviewed) sits above the
 *     revisions and shares their feed; an action re-reads it. The comments
 *     panel follows it, with its own feed.
 *   - Escape or an outside click closes the popover, except the Escape that
 *     ends an IME composition; a comment draft is kept across the close by
 *     the comments panel itself, so this file does not grow for it.
 *   - The popover uses position: fixed and the shared popup CSS tokens.
 *
 * @coordinates-with components/McpHistory/useJournalFeed.ts — live reads
 * @coordinates-with components/McpHistory/journalStatusLines.ts — attention
 * @coordinates-with components/ReviewPanel/ReviewPanel.tsx — the changes to review (loaded lazily, lazyHistoryParts.tsx)
 * @coordinates-with components/Comments/CommentsPanel.tsx — the comment threads (loaded lazily, lazyHistoryParts.tsx)
 * @coordinates-with components/McpHistory/DocumentHistoryList.tsx — revisions
 * @coordinates-with components/McpHistory/EarlierCheckpoints.tsx — earlier checkpoints
 * @coordinates-with components/McpHistory/UncommittedEntries.tsx — unrecorded writes
 * @coordinates-with stores/journalRecordingStore.ts — save problems and unbound documents
 * @module components/McpHistory/McpHistoryButton
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import { ICON_SM } from "@/utils/iconSizes";
import { isImeKeyEvent } from "@/utils/imeGuard";
import { useTranslation } from "react-i18next";
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useJournalRecordingStore } from "@/stores/journalRecordingStore";
import { docKeyFor } from "@/services/agentJournal/documentIdentity";
import { listDocumentHistory } from "@/services/agentJournal/docHistoryClient";
import { FEED_POLL_MS } from "@/services/agentJournal/journalFeed";
import { readJournalHealth, type JournalHealth } from "@/services/agentJournal/journalStatusClient";
import { getCurrentWindowLabel } from "@/services/persistence/workspaceStorage";
import { DocumentHistoryList } from "./DocumentHistoryList";
import { EarlierCheckpoints } from "./EarlierCheckpoints";
import { JournalStatusNotice } from "./JournalStatusNotice";
import { LazyCommentsPanel, LazyReviewPanel } from "./lazyHistoryParts";
import { journalStatusLines } from "./journalStatusLines";
import { UncommittedEntries } from "./UncommittedEntries";
import { useJournalFeed } from "./useJournalFeed";
import "./mcp-history.css";

const POPUP_WIDTH = 380;
const POPUP_MAX_HEIGHT = 480;

const readHealth = () => readJournalHealth();

/** Poll while the journal records but its changes are not live. */
const pollWithoutLiveUpdates = (health: JournalHealth | null): number | null =>
  health !== null && health.phase !== "failed" && health.liveUpdates !== "ready" ? FEED_POLL_MS : null;

export function McpHistoryButton(): React.ReactElement {
  const { t } = useTranslation("statusbar");
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const windowLabel = getCurrentWindowLabel();
  const tabId = useTabStore((s) => s.activeTabId[windowLabel]);
  const hasDoc = useDocumentStore((s) => (tabId ? s.documents[tabId] !== undefined : false));
  const tabFilePath = useDocumentStore((s) => (tabId ? s.documents[tabId]?.filePath ?? null : null));
  const docKey = tabId && hasDoc ? docKeyFor({ tabId, filePath: tabFilePath }, windowLabel) : null;

  const health = useJournalFeed("health", readHealth, pollWithoutLiveUpdates);
  const historyPoll = pollWithoutLiveUpdates(health.value);
  const history = useJournalFeed(docKey, listDocumentHistory, () => historyPoll);
  const problem = useJournalRecordingStore((s) => (docKey ? s.docs[docKey]?.problem ?? null : null));
  const unbound = useJournalRecordingStore((s) => (docKey ? s.unbound[docKey] === true : false));

  // A failed refresh keeps its last value; nothing here may show or offer it.
  const visibleHistory = history.failed ? null : history.value;
  const status = { health: health.value, healthFailed: health.failed, history: visibleHistory, problem, unbound };
  const attention = journalStatusLines(status).length > 0;
  const count = visibleHistory?.rows.filter((r) => r.actor.type === "mcp").length ?? 0;
  const label = attention ? t("mcpHistoryNeedsAttention") : t("mcpHistoryTitle", { count });

  // Close on outside click / escape. A comment draft survives the close
  // (components/Comments/commentDrafts.ts), so closing loses nothing.
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
      // The Escape that ends an IME composition belongs to the composition.
      if (e.key === "Escape" && !isImeKeyEvent(e)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Measure the trigger and position the popover in a layout effect — reading the
  // DOM rect during render is not concurrent-safe (#1063). No deps: remeasure every
  // render while open (the badge/count can shift the trigger rect); the functional
  // update bails when nothing moved, so there is no render loop and no flicker.
  const [popoverStyle, setPopoverStyle] = useState<React.CSSProperties>({ display: "none" });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: remeasure every render while open (see note above); functional setState bails when unchanged, so no loop.
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) {
      setPopoverStyle((prev) => (prev.display === "none" ? prev : { display: "none" }));
      return;
    }
    const right = Math.max(8, window.innerWidth - rect.right);
    const bottom = Math.max(8, window.innerHeight - rect.top + 6);
    setPopoverStyle((prev) =>
      prev.right === right && prev.bottom === bottom
        ? prev
        : { right, bottom, width: POPUP_WIDTH, maxHeight: POPUP_MAX_HEIGHT },
    );
  });

  const stateClass = attention ? "has-warning" : count > 0 ? "has-history" : "";
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`status-mcp-history ${stateClass}`}
        onClick={() => setOpen((v) => !v)}
        title={label}
        aria-label={label}
        aria-expanded={open}
        data-loaded={history.loaded || docKey === null ? "true" : "false"}
      >
        <History size={ICON_SM} />
        {count > 0 && <span className="status-mcp-history__badge">{count}</span>}
      </button>
      {open && (
        <div
          ref={popoverRef}
          className="vm-overlay__panel mcp-history-popover"
          style={popoverStyle}
          role="dialog"
          aria-label={t("mcpHistoryTitle", { count })}
        >
          <header className="vm-panel__header mcp-history-popover__header">
            <span className="mcp-history-popover__title">{t("mcpHistoryTitle", { count })}</span>
          </header>
          <div className="mcp-history-popover__body">
            <JournalStatusNotice {...status} />
            {tabId && docKey && <UncommittedEntries tabId={tabId} docKey={docKey} pollMs={historyPoll} />}
            {tabId && docKey && <LazyReviewPanel tabId={tabId} docKey={docKey} history={visibleHistory} onChanged={history.refresh} />}
            {tabId && docKey && <LazyCommentsPanel tabId={tabId} docKey={docKey} pollMs={historyPoll} />}
            {tabId && <DocumentHistoryList tabId={tabId} docKey={docKey} history={visibleHistory} failed={history.failed} />}
            <EarlierCheckpoints windowLabel={windowLabel} pollMs={historyPoll} />
          </div>
        </div>
      )}
    </>
  );
}
