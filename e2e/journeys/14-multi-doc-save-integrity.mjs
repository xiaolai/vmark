/**
 * Journey: multi-doc-save-integrity  (Tier-0 · data integrity)
 *
 * Two file-backed documents open at once, each edited with its OWN marker and
 * saved through the real `menu:save` path; this Node process then reads BOTH
 * files back from disk and asserts each contains ONLY its own marker — never
 * the other's. Proves the save pipeline writes each document to its correct
 * file with no cross-tab write bleed (the documented data-loss class — see
 * e2e/README.md "Known app issues"). Unit tests cannot cover this: it needs two
 * real tabs, two real files, and the real editor → store → disk pipeline.
 *
 * Sequencing matters: each doc is edited AND saved (dirty → clean) BEFORE the
 * next is opened, so every pending editor→store flush lands while its own tab
 * is still active — the exact discipline that avoids the bleed bug.
 *
 * Safety: skip-when-workspace (Finder-open of an outside file would spawn a
 * window), guard scratch tab, recents restore, temp dir under $HOME removed in
 * teardown. Both tabs are clean after saving, so teardown needs no discard.
 */

import { writeFile, readFile } from "node:fs/promises";
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
  poll,
} from "../lib/vmark.mjs";

async function editAndSave(client, ctx, fileTab, marker) {
  await appendToActiveEditor(client, " " + marker);
  await poll(
    () => getTabs(client),
    (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
    `edit to dirty "${fileTab.title}"`
  );
  await emitMenu(client, "save", ctx.windowLabel);
  await poll(
    () => getTabs(client),
    (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
    `save to clear dirty on "${fileTab.title}"`
  );
}

export default {
  name: "multi-doc-save-integrity",

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const fileA = join(fixture.dir, `journey-multi-A-${fixture.stamp}.md`);
    const fileB = join(fixture.dir, `journey-multi-B-${fixture.stamp}.md`);
    const titleA = basename(fileA, ".md");
    const titleB = basename(fileB, ".md");
    const markerA = `MARKER-A-${fixture.stamp}`;
    const markerB = `MARKER-B-${fixture.stamp}`;
    await writeFile(fileA, `# Doc A\n\nalpha body ${fixture.stamp}\n`, "utf8");
    await writeFile(fileB, `# Doc B\n\nbeta body ${fixture.stamp}\n`, "utf8");

    const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
    try {
      await withTabRestore(client, async ({ before, track }) => {
        const guard = await createScratchTab(client);
        track(guard.id);

        const tabA = await openFixtureInNewTab(client, {
          before,
          track,
          guardId: guard.id,
          filePath: fileA,
          title: titleA,
        });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(`alpha body ${fixture.stamp}`),
          "Doc A content loaded"
        );
        await editAndSave(client, ctx, tabA, markerA);

        const tabB = await openFixtureInNewTab(client, {
          before,
          track,
          guardId: guard.id,
          filePath: fileB,
          title: titleB,
        });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(`beta body ${fixture.stamp}`),
          "Doc B content loaded"
        );
        await editAndSave(client, ctx, tabB, markerB);

        // Ground truth: read BOTH files from disk in this process.
        const onDiskA = await readFile(fileA, "utf8");
        const onDiskB = await readFile(fileB, "utf8");
        if (!onDiskA.includes(markerA)) {
          throw new Error(`Doc A missing its marker on disk: ${JSON.stringify(onDiskA.slice(0, 200))}`);
        }
        if (onDiskA.includes(markerB)) {
          throw new Error(`Doc A CONTAMINATED with Doc B's marker (cross-tab write bleed): ${JSON.stringify(onDiskA.slice(0, 200))}`);
        }
        if (!onDiskB.includes(markerB)) {
          throw new Error(`Doc B missing its marker on disk: ${JSON.stringify(onDiskB.slice(0, 200))}`);
        }
        if (onDiskB.includes(markerA)) {
          throw new Error(`Doc B CONTAMINATED with Doc A's marker (cross-tab write bleed): ${JSON.stringify(onDiskB.slice(0, 200))}`);
        }
        ctx.log(`both docs saved to their own files, no cross-tab bleed (A=${onDiskA.length}b, B=${onDiskB.length}b)`);
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
