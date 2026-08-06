/**
 * Journey: failed-save-preserves-document  (Tier-0 · data integrity)
 *
 * The suite proves a SUCCESSFUL save writes the right bytes. This proves the
 * more dangerous half: when a save FAILS, the app must not lie about it.
 *
 * The failure class: a save fails (disk full, permissions, network volume gone),
 * the app clears the dirty dot anyway, and the user closes the tab believing the
 * work is on disk. It isn't — and the in-memory copy is now gone. That is
 * unrecoverable data loss produced entirely by an incorrect success signal, and
 * nothing below E2E can catch it: it needs a real failing filesystem write
 * through the real Rust → frontend error path.
 *
 * Invariants asserted here:
 *   1. The save is OBSERVED to fail (an error toast appears) — see below.
 *   2. The original file's bytes are untouched (no truncation, no zero-byte
 *      file, no half-written temp promoted).
 *   3. The tab REMAINS dirty — the user's unsaved work is still flagged.
 *   4. The failure is recoverable: once writability is restored, an ordinary
 *      save succeeds and writes the correct bytes.
 *
 * Why (1) is load-bearing: an earlier version simply slept 2.5s and then
 * asserted "bytes unchanged + still dirty". On a loaded machine the save can
 * still be QUEUED at that point, so those assertions hold trivially — the
 * journey would pass green without ever exercising failure handling, and the
 * delayed save would then land after permissions were restored. "Not yet
 * started" and "failed" are indistinguishable by absence. So this waits for a
 * positive failure signal (the error toast `handleWriteError` raises) before
 * inspecting anything.
 *
 * Why (4) is load-bearing: without it, a totally dead save path also satisfies
 * (2) and (3) — "nothing written and still dirty" is exactly what a broken save
 * button looks like. The retry is what makes them evidence of correct failure
 * handling rather than of no handling at all.
 *
 * Failure injection: the PARENT DIRECTORY is made owner-unwritable, so the
 * atomic temp-write + rename cannot create its temp file. This deliberately
 * avoids deleting the parent, which the app treats as a distinct
 * `PARENT_MISSING:` case that marks the document missing and routes the caller
 * through Save As — a NATIVE DIALOG, which the harness safety model forbids
 * (a blocked modal would hang the single connection for every later journey).
 * A permission error takes the generic branch in `handleWriteError`
 * (services/persistence/saveToPath.ts): a toast, no dialog.
 *
 * Cleanup: the directory mode is restored by (a) a synchronous `process.on`
 * handler registered while it is locked, because the runner's per-journey hard
 * cap uses `Promise.race` and does NOT cancel this promise — a cap firing mid-
 * journey would otherwise leave an unwritable fixture under $HOME that ordinary
 * cleanup cannot remove — and (b) the normal async `finally` path.
 */

import { writeFile, readFile, chmod, stat } from "node:fs/promises";
import { chmodSync } from "node:fs";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import {
  withTabRestore,
  createScratchTab,
  appendToActiveEditor,
  emitMenu,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  readLineEndingPreference,
  expectedEol,
  poll,
} from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";

/** Count the error toasts currently rendered (sonner). */
function errorToastCount(client) {
  return evalJs(
    client,
    `document.querySelectorAll('[data-sonner-toast][data-type="error"]').length`
  );
}

export default {
  name: "failed-save-preserves-document",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }
    if (process.platform === "win32") {
      return { skip: "directory-mode failure injection is POSIX-only" };
    }
    if (typeof process.getuid === "function" && process.getuid() === 0) {
      return { skip: "running as root — an unwritable directory would not block the write" };
    }

    const fixture = await makeAppTempDir();
    // Everything after the fixture exists must be able to clean it up.
    try {
      const filePath = join(fixture.dir, `journey-failsave-${fixture.stamp}.md`);
      const title = basename(filePath, ".md");
      const marker = `failsave-marker-${fixture.stamp}`;
      const original = `# Failed Save Journey\n\nfailsave body ${fixture.stamp}\n`;
      await writeFile(filePath, original, "utf8");

      // Restore to whatever mkdtemp actually created (0o700), not a guess.
      const originalMode = (await stat(fixture.dir)).mode & 0o777;
      const LOCKED_MODE = 0o500; // owner r-x: cannot create the temp file
      let lockedDir = false;
      let onExit = null;

      const lockDir = async () => {
        await chmod(fixture.dir, LOCKED_MODE);
        lockedDir = true;
        // Hard-cap safety: Promise.race does not cancel this journey, and the
        // runner may process.exit before any async finally runs.
        onExit = () => {
          try {
            chmodSync(fixture.dir, originalMode);
          } catch {
            /* best effort on the way out */
          }
        };
        process.on("exit", onExit);
      };
      const unlockDir = async () => {
        if (!lockedDir) return;
        await chmod(fixture.dir, originalMode);
        lockedDir = false;
        if (onExit) {
          process.off("exit", onExit);
          onExit = null;
        }
      };

      const preference = await readLineEndingPreference(client);
      const EOL = expectedEol("lf", preference);

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
            (t) => typeof t === "string" && t.includes(`failsave body ${fixture.stamp}`),
            "fixture content loaded into the editor"
          );

          await appendToActiveEditor(client, " " + marker);
          await poll(
            () => getTabs(client),
            (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
            "edit to mark the file tab dirty"
          );

          // ---- Make the destination unwritable, then save. ----
          const toastsBefore = await errorToastCount(client);
          await lockDir();
          await emitMenu(client, "save", ctx.windowLabel);

          // (1) Wait for the save to be OBSERVED to fail, not merely to not
          //     have succeeded yet.
          await poll(
            () => errorToastCount(client),
            (n) => typeof n === "number" && n > toastsBefore,
            "save failure surfaces an error toast",
            { timeoutMs: 15000, intervalMs: 250 }
          );

          // (2) The original bytes survived the failed write.
          const afterFail = await readFile(filePath, "utf8");
          if (afterFail !== original) {
            throw new Error(
              `a FAILED save corrupted the original file.\n` +
                `  expected (untouched): ${JSON.stringify(original)}\n` +
                `  on disk             : ${JSON.stringify(afterFail)}`
            );
          }

          // (3) The tab is still dirty — no false success.
          const tabsAfterFail = await getTabs(client);
          const stillDirty = tabsAfterFail.find((t) => t.id === fileTab.id)?.dirty;
          if (stillDirty !== true) {
            throw new Error(
              `a FAILED save cleared the dirty flag (false success — the user would ` +
                `close this tab believing the edit was written).\n  dirty=${JSON.stringify(stillDirty)}`
            );
          }
          ctx.log("save observed to fail: original bytes intact, tab still dirty (no false success)");

          // ---- (4) Restore writability; the same save must now succeed. ----
          await unlockDir();
          await emitMenu(client, "save", ctx.windowLabel);
          await poll(
            () => getTabs(client),
            (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
            "retry save to clear dirty once the directory is writable again"
          );

          const expected = `# Failed Save Journey${EOL}${EOL}failsave body ${fixture.stamp} ${marker}${EOL}`;
          const afterRetry = await readFile(filePath, "utf8");
          if (afterRetry !== expected) {
            throw new Error(
              `retry save wrote wrong bytes (lineEndingsOnSave="${preference}").\n` +
                `  expected: ${JSON.stringify(expected)}\n` +
                `  on disk : ${JSON.stringify(afterRetry)}`
            );
          }
          ctx.log(`recovery verified: retry saved exact bytes (${afterRetry.length}b)`);
        });
      } finally {
        // Restore the directory BEFORE anything that can throw, so cleanup can
        // always remove the fixture.
        await unlockDir().catch(() => {});
        // A failure restoring recents must not skip filesystem cleanup.
        try {
          await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
        } catch (err) {
          ctx.log(`warning: could not restore recent-files (${err?.message ?? err})`);
        }
      }
    } finally {
      await fixture.cleanup();
    }
  },
};
