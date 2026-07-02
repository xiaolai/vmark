/**
 * Journey: open-from-disk
 *
 * Writes a fixture markdown file to a throwaway temp dir, then drives the
 * app's real Finder-open pipeline (`app:open-file` event → useFinderFileOpen
 * → plugin-fs readTextFile → new tab) and asserts the file's content renders
 * in a NEW tab that loads clean (no dirty dot).
 *
 * Safety:
 *  - SKIPPED when a workspace is open — the Finder-open branch resolver
 *    (finderOpenBranch.ts) would route an outside-workspace file to a NEW
 *    WINDOW, which this suite must never spawn.
 *  - A guard scratch tab is created first so the "replaceable tab" branch
 *    can never consume a pre-existing clean untitled tab (replace fires only
 *    when the untitled tab is the ONLY tab).
 *  - The open adds one entry to the recent-files list; its persisted state
 *    (localStorage "vmark-recent-files") is snapshotted and restored. The
 *    in-memory copy for the current session cannot be edited from outside
 *    the app — documented residue, gone on app restart.
 */

import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import {
  withTabRestore,
  createScratchTab,
  getTabs,
  getEditorText,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "open-from-disk",

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-open-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const body = `open-from-disk body ${fixture.stamp}`;
    await writeFile(filePath, `# Open Journey\n\n${body}\n`, "utf8");

    const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
    try {
      await withTabRestore(client, async ({ before, track }) => {
        // Guard tab: guarantees the open lands in a NEW tab (create branch).
        const guard = await createScratchTab(client);
        track(guard.id);

        const fileTab = await openFixtureInNewTab(client, {
          before,
          track,
          guardId: guard.id,
          filePath,
          title,
        });
        ctx.log(`fixture opened in new tab ${fileTab.id}`);

        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(body),
          "fixture content rendered in the editor"
        );
        const now = (await getTabs(client)).find((t) => t.id === fileTab.id);
        if (now.dirty) throw new Error("freshly opened file is marked dirty");
        ctx.log("content rendered, tab loaded clean");
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
