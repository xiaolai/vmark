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
import { evalJs } from "./bridge.mjs";

/**
 * Open `filePath` through the Finder-open pipeline and wait for its tab.
 *
 * @param {object} client Bridge client.
 * @param {{ before: Array, track: Function, guardId: string, filePath: string, title?: string }} opts
 *   `before`/`track` come from `withTabRestore`; `guardId` is the scratch
 *   guard tab's id. `title` is DERIVED from `filePath` and ignored if passed —
 *   see below.
 * @returns {Promise<{id: string, title: string, selected: boolean, dirty: boolean}>}
 *   The freshly opened, active file tab (already `track`ed for teardown).
 */
export async function openFixtureInNewTab(client, { before, track, guardId, filePath }) {
  // The expected title is the file's basename AS IT EXISTS ON DISK, derived
  // here rather than restated by each caller.
  //
  // It used to be "basename sans .md", and callers passed it themselves. commit
  // 6848de868 (2026-08-07) made `general.showFileExtensions` default TRUE and
  // routed the tab strip through it, so tabs render `notes.md`, not `notes` —
  // and every Tier-0 journey that opens a fixture has been broken since. Nobody
  // saw it because nothing ran this suite: it was CI-verified only as mock
  // choreography, and the real-app tier ran when a maintainer remembered.
  // Two days of silent breakage is the cheap version of that lesson; the
  // expensive version is a data-integrity regression shipping the same way.
  const expected = filePath.split("/").pop();

  // Assert the assumption instead of depending on it silently. If the default
  // ever flips back, this fails saying so, rather than timing out on a tab that
  // is sitting right there under a different name — which is exactly how the
  // 2026-08-07 breakage presented.
  const showsExtensions = await evalJs(
    client,
    `(() => {
       try {
         const raw = localStorage.getItem("vmark-settings");
         if (!raw) return null;
         const s = JSON.parse(raw);
         return (s?.state?.general ?? s?.general)?.showFileExtensions ?? null;
       } catch { return null; }
     })()`
  );
  if (showsExtensions === false) {
    throw new Error(
      "general.showFileExtensions is false, so tab titles omit the extension. " +
        "This helper derives the expected title from the filename on disk; " +
        "teach it the stripping rule before running with that setting."
    );
  }

  await emitEvent(client, "app:open-file", { path: filePath, workspace_root: null });
  const tabs = await poll(
    () => getTabs(client),
    (ts) => ts.some((t) => t.title === expected),
    `tab for ${expected} to open`
  );
  const fileTab = tabs.find((t) => t.title === expected);
  track(fileTab.id);
  if (before.some((t) => t.id === fileTab.id) || fileTab.id === guardId) {
    throw new Error("file open reused an existing tab — expected a fresh tab");
  }
  if (!fileTab.selected) throw new Error("opened file tab is not active");
  return fileTab;
}
