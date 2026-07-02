/**
 * Shared helpers for disk journeys (09-open-from-disk, 10-save-to-disk).
 *
 * Both journeys drive the app's real Finder-open pipeline
 * (`app:open-file` event → useFinderFileOpen → plugin-fs readTextFile →
 * new tab) against a fixture file and need identical guarantees before
 * touching the opened document: the file landed in a FRESH tab (not a reused
 * pre-existing tab, not the guard scratch tab) and that tab is ACTIVE — so
 * subsequent editor reads/edits verifiably target the fixture document.
 */

import { emitEvent, getTabs, poll } from "./vmark.mjs";

/**
 * Open `filePath` through the Finder-open pipeline and wait for its tab.
 *
 * @param {object} client Bridge client.
 * @param {{ before: Array, track: Function, guardId: string, filePath: string, title: string }} opts
 *   `before`/`track` come from `withTabRestore`; `guardId` is the scratch
 *   guard tab's id; `title` is the expected tab title (basename sans .md).
 * @returns {Promise<{id: string, title: string, selected: boolean, dirty: boolean}>}
 *   The freshly opened, active file tab (already `track`ed for teardown).
 */
export async function openFixtureInNewTab(client, { before, track, guardId, filePath, title }) {
  await emitEvent(client, "app:open-file", { path: filePath, workspace_root: null });
  const tabs = await poll(
    () => getTabs(client),
    (ts) => ts.some((t) => t.title === title),
    `tab for ${title} to open`
  );
  const fileTab = tabs.find((t) => t.title === title);
  track(fileTab.id);
  if (before.some((t) => t.id === fileTab.id) || fileTab.id === guardId) {
    throw new Error("file open reused an existing tab — expected a fresh tab");
  }
  if (!fileTab.selected) throw new Error("opened file tab is not active");
  return fileTab;
}
