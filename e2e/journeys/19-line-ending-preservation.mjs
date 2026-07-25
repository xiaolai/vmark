/**
 * Journey: line-ending-preservation  (Tier-0 · data integrity)
 *
 * A CRLF file opened, edited and saved must come back off disk still CRLF.
 * If this breaks, every line of a Windows-authored document changes on the
 * first save: the diff shows the whole file rewritten, version control shows a
 * total-file change, and the user's actual edit is buried. It is a silent,
 * whole-file corruption class that no jsdom test can observe, because the only
 * evidence is the bytes on disk — `getEditorText()` and the document model both
 * hold normalized `\n` regardless of what was written.
 *
 * The contract (src/utils/linebreaks.ts `resolveLineEndingOnSave`, applied by
 * services/persistence/saveToPath.ts on EVERY save):
 *
 *     preference "lf"       → always lf
 *     preference "crlf"     → always crlf
 *     preference "preserve" → whatever the document was opened as
 *
 * Rather than assume the default, this journey READS the live preference and
 * derives the expectation from it, so it asserts the real contract under the
 * user's actual configuration instead of skipping (or worse, failing) when the
 * setting is non-default. Ambient configuration changing behavior is a
 * documented harness trap — the fix is to bind the oracle to the config, not to
 * ignore it.
 *
 * Oracle: the FULL expected buffer, byte for byte. A "contains the marker"
 * check would pass on a file whose every newline had been converted — exactly
 * the bug this exists to catch.
 *
 * Safety: identical to the other disk journeys — skip-when-workspace (a
 * Finder-open of an outside file would spawn a window), guard scratch tab,
 * recents restore, temp dir under $HOME removed in teardown. The tab is clean
 * after saving, so teardown needs no discard.
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
  readLineEndingPreference,
  expectedEol,
  poll,
} from "../lib/vmark.mjs";

/** Describe the newline styles actually present, for a useful failure message. */
function describeEndings(text) {
  const crlf = (text.match(/\r\n/g) || []).length;
  const loneLf = (text.match(/(^|[^\r])\n/g) || []).length;
  const loneCr = (text.match(/\r(?!\n)/g) || []).length;
  return `crlf=${crlf} lone-lf=${loneLf} lone-cr=${loneCr}`;
}

export default {
  name: "line-ending-preservation",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const preference = await readLineEndingPreference(client);
    const EOL = expectedEol("crlf", preference);
    const expectedEnding = EOL === "\r\n" ? "crlf" : "lf";
    ctx.log(`lineEndingsOnSave="${preference}" → a CRLF document must save as ${expectedEnding.toUpperCase()}`);

    const fixture = await makeAppTempDir();
    try {
    const filePath = join(fixture.dir, `journey-eol-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const marker = `eol-marker-${fixture.stamp}`;
    // Written with CRLF throughout — this is the document's opened-as identity.
    const original = `# CRLF Journey\r\n\r\ncrlf body ${fixture.stamp}\r\n`;
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
          (t) => typeof t === "string" && t.includes(`crlf body ${fixture.stamp}`),
          "CRLF fixture content loaded into the editor"
        );

        await appendToActiveEditor(client, " " + marker);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
          "edit to mark the CRLF file tab dirty"
        );

        await emitMenu(client, "save", ctx.windowLabel);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
          "save to clear dirty on the CRLF file"
        );

        // Ground truth: the whole buffer, including every newline.
        const expected = `# CRLF Journey${EOL}${EOL}crlf body ${fixture.stamp} ${marker}${EOL}`;
        const onDisk = await readFile(filePath, "utf8");
        if (onDisk !== expected) {
          throw new Error(
            `line endings or content wrong after save.\n` +
              `  preference: ${preference} → expected ${expectedEnding}\n` +
              `  expected (${expected.length}b, ${describeEndings(expected)}): ${JSON.stringify(expected)}\n` +
              `  on disk  (${onDisk.length}b, ${describeEndings(onDisk)}): ${JSON.stringify(onDisk)}`
          );
        }
        ctx.log(`saved bytes preserved ${expectedEnding.toUpperCase()} exactly (${onDisk.length}b, ${describeEndings(onDisk)})`);
      });
    } finally {
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
