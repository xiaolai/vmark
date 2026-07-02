/**
 * Journey: save-to-disk
 *
 * The full disk round trip through the app's REAL save pipeline:
 * open a fixture file (Finder-open path) → edit it in the live editor →
 * `menu:save` (useFileShortcuts → saveToPath → Rust atomic_write_file) →
 * dirty dot clears → this Node process reads the file back FROM DISK and
 * asserts the edit landed. This is exactly the jsdom-unreachable flow the
 * vitest coverage notes call out.
 *
 * Same safety model as open-from-disk (skip-when-workspace, guard tab,
 * recents restore, temp dir under $HOME removed in teardown). The tab is
 * clean after saving, so teardown's close needs no discard.
 */

import { writeFile, readFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import {
  withTabRestore,
  createScratchTab,
  emitMenu,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  poll,
} from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";

export default {
  name: "save-to-disk",

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-save-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const original = `# Save Journey\n\nsave body ${fixture.stamp}\n`;
    const marker = `disk-marker-${fixture.stamp}`;
    await writeFile(filePath, original, "utf8");

    const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
    try {
      await withTabRestore(client, async ({ before, track }) => {
        const guard = await createScratchTab(client);
        track(guard.id);

        // Open the fixture through the real Finder-open pipeline.
        const fileTab = await openFixtureInNewTab(client, {
          before,
          track,
          guardId: guard.id,
          filePath,
          title,
        });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(`save body ${fixture.stamp}`),
          "fixture content loaded into the editor"
        );

        // Edit: append the marker at the end of the document.
        await evalJs(
          client,
          `(() => {
             const el = document.querySelector('.ProseMirror');
             el.focus();
             const sel = window.getSelection();
             sel.selectAllChildren(el);
             sel.collapseToEnd();
             document.execCommand('insertText', false, ${JSON.stringify(" " + marker)});
             return true;
           })()`
        );
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
          "edit to mark the file tab dirty"
        );
        ctx.log("fixture edited in the live editor (dirty)");

        // Save through the real menu path — no dialog (tab has a filePath).
        await emitMenu(client, "save", ctx.windowLabel);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
          "save to clear the dirty indicator"
        );

        // Ground truth: read the bytes back from disk in THIS process.
        const onDisk = await readFile(filePath, "utf8");
        if (!onDisk.includes(marker)) {
          throw new Error(`saved file does not contain the marker.\n  disk: ${JSON.stringify(onDisk.slice(0, 200))}`);
        }
        if (onDisk === original) {
          throw new Error("file bytes unchanged after save");
        }
        ctx.log(`save verified on disk (${onDisk.length} bytes, marker present)`);
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
