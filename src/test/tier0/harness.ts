/**
 * Shared setup for the Tier-0 jsdom integration suites (WI-17).
 *
 * These suites drive the REAL flow composition — real Zustand stores, real
 * services — with `@tauri-apps/*` as the only mocked boundary, behind
 * `src/test/statefulFsFake.ts`. Nothing here mocks app modules; it resets
 * real store state between tests and opens documents through the production
 * open path itself (`services/navigation/fileOpen`).
 *
 * Concurrency / data-integrity protocol the flows assert: decision ledger D6
 * (`.claude/tdd-guardian/decisions-20260803.md`).
 *
 * @module test/tier0/harness
 */
import { useDocumentStore } from "@/stores/documentStore";
import { useTabStore } from "@/stores/tabStore";
import { useWorkspaceStore, useRecentFilesStore } from "@/stores/workspaceStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { openFileInNewTab } from "@/services/navigation/fileOpen";
import { createUntitledTab } from "@/services/navigation/newFile";
import { _clearAllPendingSaves } from "@/utils/pendingSaves";
import { statefulFs } from "@/test/statefulFsFake";

/** The window every Tier-0 flow runs in (matches the setup.ts window mock). */
export const WINDOW = "main";
/** Workspace root the fake disk is rooted at. */
export const ROOT = "/repo";

/**
 * Reset every real store the Tier-0 flows touch, plus the module-level
 * pending-save registry and the fake disk. Call in `beforeEach`.
 */
export function resetTier0(): void {
  statefulFs.reset();
  statefulFs.mkdirp(ROOT);
  // Explicit, named stubs for the non-filesystem commands these flows reach.
  // Listed here rather than defaulted inside the fake: each one is a claim
  // that the command is irrelevant to the bytes-on-disk question, and an
  // unlisted command still rejects loudly.
  statefulFs.stubCommand("update_recent_files", () => undefined); // native menu sync
  _clearAllPendingSaves();
  useDocumentStore.setState({ documents: {} });
  useTabStore.setState({ tabs: {}, activeTabId: {} });
  useRecentFilesStore.setState({ files: [] });
  useWorkspaceStore.setState({ rootPath: ROOT, config: null, isWorkspaceMode: true });
  // History is ON by default and part of the real save path; it writes into
  // the fake disk under the mocked appDataDir. Only the settings the flows
  // depend on are pinned — everything else stays at shipped defaults.
  useSettingsStore.setState((s) => ({
    general: {
      ...s.general,
      autoSaveEnabled: false, // the autosave suite turns it on explicitly
      coherenceCaptureOnSave: false,
      historyEnabled: true,
    },
  }));
}

/**
 * Seed `path` on the fake disk and open it through the REAL open flow.
 *
 * Deliberately not a hand-rolled `ingestExternalContent` call: this tier
 * exists to exercise production composition, and `externalWriterGate.test.ts`
 * is right to refuse a second ingress into the document store.
 */
export async function openDocInTab(path: string, content: string): Promise<string> {
  statefulFs.seed(path, content);
  await openFileInNewTab(WINDOW, path);
  const tab = useTabStore.getState().getTabsByWindow(WINDOW).find((t) => t.filePath === path);
  if (!tab) throw new Error(`tier0 harness: open flow produced no tab for ${path}`);
  useTabStore.getState().setActiveTab(WINDOW, tab.id);
  return tab.id;
}

/** A blank untitled tab through the real New-file path. */
export function newUntitledTab(): string {
  const tabId = createUntitledTab(WINDOW);
  useTabStore.getState().setActiveTab(WINDOW, tabId);
  return tabId;
}

/** Apply a user edit through the real editor door (marks the doc dirty). */
export function editDoc(tabId: string, content: string): void {
  useDocumentStore.getState().setEditorContent(tabId, content);
}

/**
 * Drain the promise chains a flow leaves in flight after a timer tick.
 *
 * A save awaits the write, the store update AND the history snapshot; the
 * fake resolves all of them on microtasks, but `advanceTimersByTimeAsync`
 * only yields between timers. Without this, a save started by the last tick
 * of one test finishes during the next one and shows up as a phantom write.
 */
export async function settle(cycles = 12): Promise<void> {
  for (let i = 0; i < cycles; i++) await Promise.resolve();
}

/** The live document record, or a loud failure when the tab has none. */
export function doc(tabId: string) {
  const record = useDocumentStore.getState().getDocument(tabId);
  if (!record) throw new Error(`tier0 harness: no document for tab ${tabId}`);
  return record;
}
