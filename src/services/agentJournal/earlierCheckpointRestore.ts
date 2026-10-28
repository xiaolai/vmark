/**
 * Earlier checkpoint restore — put a pre-journal checkpoint's text back,
 * from the history panel's global "Earlier checkpoints" list, into the
 * document it belongs to, or into a new untitled document.
 *
 * Key decisions:
 *   - A file checkpoint restores into that file: its tab in this window when
 *     open, else the file is opened first. A user who cancels the open (a
 *     large-file prompt) stops the restore: they said no.
 *   - A file that cannot be opened (missing, unreadable, closed during the
 *     read, or the open threw) still gets its text back, in a new untitled
 *     document; the outcome names the path and why, so the panel can say so.
 *   - An untitled checkpoint always goes to a new untitled document: the tab
 *     it came from is gone after a restart and its id is not reused.
 *   - A restore that is refused, aborted or throws removes the untitled
 *     document it created only while it is exactly as created: still
 *     untitled, empty, same document and MCP revision (typing and clearing
 *     it, or a Save As, keeps it). A created tab whose document went missing
 *     is removed too: no blank or orphan tab per failure.
 *   - The restore itself is the journal's controlled restore with the
 *     `legacyCheckpoint` source, so the overwritten text is recorded first.
 *
 * @coordinates-with services/agentJournal/historyRestore.ts — the restore
 * @coordinates-with services/navigation/fileOpen.ts — opening the file
 * @coordinates-with services/navigation/newFile.ts — the untitled fallback
 * @module services/agentJournal/earlierCheckpointRestore
 */

import { useDocumentStore, useRevisionStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { openFileInNewTabCore, type OpenOutcome } from "@/services/navigation/fileOpen";
import { createUntitledTab } from "@/services/navigation/newFile";
import type { JournalCheckpoint } from "./checkpointClient";
import { restoreFromHistory, type HistoryRestoreOutcome } from "./historyRestore";

/** Why a file checkpoint went to an untitled document instead. */
interface CheckpointFallback {
  path: string;
  reason: Extract<OpenOutcome, "failed" | "closed">;
}

export type EarlierRestoreOutcome =
  | { status: "cancelled" }
  | { status: "restored"; tabId: string; outcome: HistoryRestoreOutcome; fallback: CheckpointFallback | null };

/** A created document as it was made: what "untouched" is compared against. */
interface Created {
  documentId: number | undefined;
  revision: string;
}

/** `created`: the tab is a new empty document made for this restore, as it was made. */
type Target = { tabId: string; fallback: CheckpointFallback | null; created: Created | null } | "cancelled";

function untitled(windowLabel: string, fallback: CheckpointFallback | null): Target {
  const tabId = createUntitledTab(windowLabel);
  const created = {
    documentId: useDocumentStore.getState().documents[tabId]?.documentId,
    revision: useRevisionStore.getState().getRevision(tabId),
  };
  return { tabId, fallback, created };
}

async function targetFor(path: string | null, windowLabel: string): Promise<Target> {
  if (!path) return untitled(windowLabel, null);
  const open = useTabStore.getState().findTabByPath(windowLabel, path);
  if (open) return { tabId: open.id, fallback: null, created: null };
  let created: string | null = null;
  let result: OpenOutcome;
  try {
    result = await openFileInNewTabCore(windowLabel, path, { onTabCreated: (id) => (created = id) });
  } catch {
    result = "failed";
  }
  if (result === "refused") return "cancelled";
  if ((result === "opened" || result === "deduped") && created !== null) return { tabId: created, fallback: null, created: null };
  return untitled(windowLabel, { path, reason: result === "closed" ? "closed" : "failed" });
}

/** Restore checkpoint `cp` in window `windowLabel`; see the header for where it lands. */
export async function restoreEarlierCheckpoint(cp: JournalCheckpoint, windowLabel: string): Promise<EarlierRestoreOutcome> {
  const target = await targetFor(cp.filePath, windowLabel);
  if (target === "cancelled") return { status: "cancelled" };
  let outcome: HistoryRestoreOutcome | null = null;
  try {
    outcome = await restoreFromHistory(target.tabId, { from: "legacyCheckpoint", legacyId: cp.id });
  } finally {
    // @edge-case A restore that throws is not applied either: no orphan tab.
    if (target.created && outcome?.status !== "applied") dropIfUntouched(windowLabel, target.tabId, target.created);
  }
  return { status: "restored", tabId: target.tabId, outcome, fallback: target.fallback };
}

/** Remove a document this restore created, unless anything changed it since; an orphan tab (its document gone) goes too. */
function dropIfUntouched(windowLabel: string, tabId: string, created: Created): void {
  const doc = useDocumentStore.getState().documents[tabId];
  if (doc) {
    const same = doc.documentId === created.documentId && useRevisionStore.getState().revisions[tabId]?.revision === created.revision;
    if (!same || doc.filePath !== null || doc.content !== "") return;
  } else if (!(useTabStore.getState().tabs[windowLabel] ?? []).some((t) => t.id === tabId)) {
    return;
  }
  // A rollback, not the user's close: nothing goes to the reopen history.
  useTabStore.getState().detachTab(windowLabel, tabId);
}
