/**
 * Journey: workflow-split-pane
 *
 * A GitHub Actions workflow file (detected by its `.github/workflows/` path,
 * `kind: "split-pane"`) opens in the generic SplitPaneEditor with the
 * gha-workflow renderer — NOT the markdown WYSIWYG editor. Exercises the
 * format registry's path-based schema detection (WI-2.4) and the workflow
 * viewer subsystem end-to-end.
 *
 * Asserts: a `.cm-editor` source surface + a `[data-schema="gha-workflow"]`
 * render surface mount, with NO `.ProseMirror`. Safety mirrors open-from-disk
 * (workspace-open SKIP, guard scratch tab, recent-files restore).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
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

const WORKFLOW_YAML = `name: E2E Probe
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`;

export default {
  name: "workflow-split-pane",

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    // Path detection wins: a file under `.github/workflows/` → gha-workflow kind.
    const wfDir = join(fixture.dir, ".github", "workflows");
    await mkdir(wfDir, { recursive: true });
    const filePath = join(wfDir, `journey-wf-${fixture.stamp}.yml`);
    // The gha-workflow format strips the `.yml` extension in the tab title
    // (unlike generic source formats such as `.json`, which keep it).
    const title = basename(filePath, ".yml");
    await writeFile(filePath, WORKFLOW_YAML, "utf8");

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
        ctx.log(`workflow fixture opened in new tab ${fileTab.id}`);

        const surfaces = await poll(
          () =>
            evalJs(
              client,
              `(() => ({
                 cm: !!document.querySelector('.cm-editor'),
                 pm: !!document.querySelector('.ProseMirror'),
                 wf: !!document.querySelector('[data-schema="gha-workflow"]'),
               }))()`
            ),
          (s) => s.cm && s.wf,
          "workflow file to mount the split-pane source + gha-workflow renderer"
        );
        if (surfaces.pm) {
          throw new Error("a .ProseMirror (WYSIWYG) surface mounted for a workflow file — kind misdispatched");
        }
        const now = (await getTabs(client)).find((t) => t.id === fileTab.id);
        if (now.dirty) throw new Error("freshly opened workflow file is marked dirty");
        ctx.log("workflow routed to split-pane + gha-workflow renderer, no WYSIWYG surface");
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
