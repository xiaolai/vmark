/**
 * Journey: dirty-file-close-guard  (Tier-0 · data integrity)
 *
 * The close DECISION on a real file-backed document — the highest-stakes
 * data-loss path:
 *   - a DIRTY file tab REFUSES a non-force close (`vmark.workspace.close`
 *     replies `{closed:false, reason:"DIRTY"}`, no dialog) — unsaved edits are
 *     never silently dropped;
 *   - after `menu:save` the tab is CLEAN and a non-force close SUCCEEDS.
 *
 * Complements scratch-tab-roundtrip, which proves the same guard on an UNTITLED
 * tab; this proves it on a file-backed document, where a wrong close decision
 * discards edits to a real file on disk.
 *
 * Safety: skip-when-workspace, guard scratch tab, recents restore, temp dir
 * under $HOME removed in teardown. The file tab is closed (clean) by the journey
 * itself; teardown's force-close of a tracked-but-gone tab is a no-op.
 */

import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import {
  withTabRestore,
  createScratchTab,
  appendToActiveEditor,
  emitMenu,
  mcpFire,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "dirty-file-close-guard",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-close-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const marker = `close-marker-${fixture.stamp}`;
    await writeFile(filePath, `# Close Journey\n\nclose body ${fixture.stamp}\n`, "utf8");

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
          (t) => typeof t === "string" && t.includes(`close body ${fixture.stamp}`),
          "fixture content loaded"
        );

        // Edit → dirty.
        await appendToActiveEditor(client, " " + marker);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
          "edit to mark the file tab dirty"
        );

        // A non-force close of a DIRTY file tab must be REFUSED (no dialog, no
        // silent drop). Observe: the tab is still present for the full window.
        await mcpFire(client, "vmark.workspace.close", { tabId: fileTab.id, force: false });
        const deadline = Date.now() + 900;
        while (Date.now() < deadline) {
          const now = await getTabs(client);
          if (!now.some((t) => t.id === fileTab.id)) {
            throw new Error("dirty FILE tab closed WITHOUT force — unsaved edits would be lost (dirty-guard regression)");
          }
          await new Promise((r) => setTimeout(r, 200));
        }
        ctx.log("non-force close of the dirty file tab correctly refused");

        // Save → clean.
        await emitMenu(client, "save", ctx.windowLabel);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
          "save to clear the dirty indicator"
        );

        // A non-force close of the now-CLEAN tab must SUCCEED (no data at risk).
        await mcpFire(client, "vmark.workspace.close", { tabId: fileTab.id, force: false });
        await poll(
          () => getTabs(client),
          (ts) => !ts.some((t) => t.id === fileTab.id),
          "clean file tab to close on a non-force close"
        );
        ctx.log("non-force close of the clean file tab succeeded");
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
