/**
 * Journey: autosave-persists-to-disk  (Tier-0 · data integrity)
 *
 * Proves the autosave pipeline reaches disk WITHOUT an explicit save: edit a
 * file-backed document, then wait for the interval-driven autosave
 * (`useAutoSave` → `saveToPath(..., "auto")`) and read the bytes back from disk.
 * This silent-protection guarantee is exactly what users rely on and is
 * invisible to jsdom.
 *
 * Timing is the app's REAL autosave interval, read from persisted settings
 * (`vmark-settings` → `state.general.autoSaveInterval`, default 30s). The
 * journey does NOT mutate the user's settings — no settings-store handle is
 * exposed to automation — so it SKIPs when autosave is disabled or the interval
 * is too large for an automated run. This is intentionally the SLOWEST journey.
 *
 * Safety: skip-when-workspace, guard scratch tab, recents restore, temp dir
 * under $HOME removed in teardown. Autosave clears the dirty flag
 * (`markAutoSaved`) so the tab is clean at teardown; force-close is harmless.
 */

import { writeFile, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import {
  withTabRestore,
  createScratchTab,
  appendToActiveEditor,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  poll,
} from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";

/** Read the persisted autosave settings (default-safe). */
async function readAutosaveSettings(client) {
  const raw = await evalJs(client, `localStorage.getItem("vmark-settings")`);
  try {
    const general = JSON.parse(raw)?.state?.general ?? {};
    return {
      enabled: general.autoSaveEnabled ?? true,
      interval: Number.isFinite(general.autoSaveInterval) ? general.autoSaveInterval : 30,
    };
  } catch {
    return { enabled: true, interval: 30 };
  }
}

// Above this the wait would crowd the 90s per-journey hard cap — run manually.
const MAX_AUTOMATED_INTERVAL_S = 40;

export default {
  name: "autosave-persists-to-disk",
  // NOT coverageRequired: this journey's skips are legitimate USER STATE, not
  // lost coverage. It skips when autosave is disabled or its interval exceeds
  // what an automated run can wait for — both valid configurations the harness
  // deliberately refuses to mutate. Making them fatal would turn a healthy run
  // red for a setting the user is entitled to choose. (The workspace-open skip
  // it shares with the other disk journeys is a different matter, but the flag
  // is per-journey, so the weaker constraint wins.) Enforcing I6 unconditionally
  // needs an isolated profile with autosave pinned on — see e2e/README.md.

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const { enabled, interval } = await readAutosaveSettings(client);
    if (!enabled) {
      return { skip: "autosave disabled in settings — journey respects the user's live setting" };
    }
    if (interval > MAX_AUTOMATED_INTERVAL_S) {
      return { skip: `autoSaveInterval ${interval}s exceeds ${MAX_AUTOMATED_INTERVAL_S}s — too slow for an automated run; verify manually` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-autosave-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const original = `# Autosave Journey\n\nautosave body ${fixture.stamp}\n`;
    const marker = `autosave-marker-${fixture.stamp}`;
    await writeFile(filePath, original, "utf8");

    const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
    try {
      await withTabRestore(client, async ({ before, track }) => {
        const guard = await createScratchTab(client);
        track(guard.id);

        const fileTab = await openFixtureInNewTab(client, {
          before,
          track,
          guardId: guard.id,
          filePath,
          title,
        });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(`autosave body ${fixture.stamp}`),
          "fixture content loaded"
        );

        // Edit → dirty. Then do NOT save — the interval must save it for us.
        await appendToActiveEditor(client, " " + marker);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
          "edit to mark the file tab dirty"
        );
        ctx.log(`edited (dirty); waiting up to ~${interval + 12}s for the autosave interval`);

        // Ground truth: poll disk in THIS process until autosave writes the marker.
        const onDisk = await poll(
          () => readFile(filePath, "utf8"),
          (bytes) => bytes.includes(marker),
          "autosave to write the edit to disk (no explicit save)",
          { timeoutMs: interval * 1000 + 12000, intervalMs: 1000 }
        );
        if (onDisk === original) {
          throw new Error("file bytes unchanged — autosave did not persist the edit");
        }

        // Autosave clears the dirty flag via markAutoSaved.
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
          "autosave to clear the dirty indicator"
        );
        ctx.log(`autosave persisted the edit to disk (${onDisk.length}b, marker present, tab clean)`);
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
