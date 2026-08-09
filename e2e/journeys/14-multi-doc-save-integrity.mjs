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
import { join } from "node:path";
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
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const fileA = join(fixture.dir, `journey-multi-A-${fixture.stamp}.md`);
    const fileB = join(fixture.dir, `journey-multi-B-${fixture.stamp}.md`);
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
        });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(`beta body ${fixture.stamp}`),
          "Doc B content loaded"
        );
        await editAndSave(client, ctx, tabB, markerB);

        // Ground truth: read BOTH files from disk in this process and compare
        // each WHOLE file to its exact expected serialization.
        //
        // Marker inclusion/exclusion is too weak an oracle here: it proves the
        // other document's marker is absent, but would still pass if a save
        // truncated a file, dropped its heading, doubled its body, or converted
        // its line endings. Exact equality subsumes the contamination check
        // (B's marker cannot be present in a buffer that equals A's expectation)
        // AND catches every partial-write mode alongside it.
        // EOL comes from the live `lineEndingsOnSave` preference — hardcoding
        // "\n" would fail on CORRECT output under a "crlf" setting.
        const preference = await readLineEndingPreference(client);
        const EOL = expectedEol("lf", preference);
        const expectedA = `# Doc A${EOL}${EOL}alpha body ${fixture.stamp} ${markerA}${EOL}`;
        const expectedB = `# Doc B${EOL}${EOL}beta body ${fixture.stamp} ${markerB}${EOL}`;
        const onDiskA = await readFile(fileA, "utf8");
        const onDiskB = await readFile(fileB, "utf8");
        if (onDiskA !== expectedA) {
          throw new Error(
            `Doc A bytes wrong (corruption or cross-tab write bleed, lineEndingsOnSave="${preference}").\n` +
              `  expected: ${JSON.stringify(expectedA)}\n` +
              `  on disk : ${JSON.stringify(onDiskA)}`
          );
        }
        if (onDiskB !== expectedB) {
          throw new Error(
            `Doc B bytes wrong (corruption or cross-tab write bleed, lineEndingsOnSave="${preference}").\n` +
              `  expected: ${JSON.stringify(expectedB)}\n` +
              `  on disk : ${JSON.stringify(onDiskB)}`
          );
        }
        ctx.log(`both docs exact-byte verified, no cross-tab bleed (A=${onDiskA.length}b, B=${onDiskB.length}b)`);
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
