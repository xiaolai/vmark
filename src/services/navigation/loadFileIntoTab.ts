/**
 * Load file content into a tab (new or existing) — extracted from
 * hooks/useFinderFileOpen in the WI-10 hooks→services migration so
 * non-React callers (openWorkflowTarget, finder branch contexts) do not
 * reach into the hooks tier.
 *
 * @coordinates-with hooks/useFinderFileOpen.ts — the Finder-open pipeline consumer
 * @coordinates-with services/navigation/finderOpenBranches.ts — receives this via ctx
 * @module services/navigation/loadFileIntoTab
 */
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTabStore } from "@/stores/tabStore";
import { useDocumentStore } from "@/stores/documentStore";
import { useRecentFilesStore } from "@/stores/workspaceStore";

/**
 * Load file content into a tab (new or existing).
 * Throws on read failure so callers can handle cleanup.
 */
export async function loadFileIntoTab(tabId: string, path: string): Promise<void> {
  const content = await readTextFile(path);
  // Close-during-open guard, mirroring fileOpen.ts (WI-0.2, C1) — writing now
  // would resurrect an orphan document for a tab closed mid-read.
  if (!useTabStore.getState().findTabById(tabId)) return;

  // WI-1B.6 / WI-2.6 — registry-driven mode dispatch: .yaml/.yml route to the
  // YAML adapter (split-pane), so no force-source is needed. The disk-open
  // ingest creates the document when new and replaces it otherwise.
  useDocumentStore.getState().ingestExternalContent(tabId, content, "disk-open", {
    filePath: path,
  });
  useRecentFilesStore.getState().addFile(path);
}
