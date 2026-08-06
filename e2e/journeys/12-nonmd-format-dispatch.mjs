/**
 * Journey: nonmd-format-dispatch
 *
 * Confirms the format registry (the ADR-015 / WI-4A work: `FormatConfig` +
 * registry-driven source host) routes a NON-markdown file to the CodeMirror
 * source surface — NOT the markdown WYSIWYG editor. Opens a real `.json`
 * fixture through the Finder-open pipeline and asserts: a `.cm-editor` mounts,
 * NO `.ProseMirror` is present (markdown would have mounted one), and the file
 * bytes are visible in the source pane.
 *
 * Safety mirrors open-from-disk: SKIP when a workspace is open (Finder-open of
 * an outside file would spawn a window), a guard scratch tab prevents the
 * replaceable-tab branch, and recent-files localStorage is snapshotted/restored.
 */

import { writeFile } from "node:fs/promises";
import { join, basename } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  getTabs,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "nonmd-format-dispatch",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-format-${fixture.stamp}.json`);
    // Non-markdown tabs keep their extension in the title (markdown strips `.md`).
    const title = basename(filePath);
    const marker = `nonmd-${fixture.stamp}`;
    await writeFile(filePath, `{\n  "journey": "${marker}",\n  "value": 42\n}\n`, "utf8");

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
        ctx.log(`json fixture opened in new tab ${fileTab.id}`);

        // The format registry must route a non-markdown file to the SOURCE
        // (CodeMirror) surface — a markdown file would mount a .ProseMirror.
        const surfaces = await poll(
          () =>
            evalJs(
              client,
              `(() => ({
                 cm: !!document.querySelector('.cm-editor'),
                 pm: !!document.querySelector('.ProseMirror'),
                 text: document.querySelector('.cm-content')?.textContent ?? '',
               }))()`
            ),
          (s) => s.cm && s.text.includes(marker),
          "json fixture to mount the CodeMirror source surface with its content"
        );
        if (surfaces.pm) {
          throw new Error("a .ProseMirror (WYSIWYG) surface mounted for a .json file — format misdispatched");
        }
        const now = (await getTabs(client)).find((t) => t.id === fileTab.id);
        if (now.dirty) throw new Error("freshly opened json file is marked dirty");
        ctx.log("non-markdown format routed to source editor, no WYSIWYG surface, loaded clean");
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
