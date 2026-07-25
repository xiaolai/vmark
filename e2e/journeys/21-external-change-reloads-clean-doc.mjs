/**
 * Journey: external-change-reloads-clean-doc  (Tier-0 · data integrity — I11)
 *
 * Closes the CLEAN half of matrix row I11, which was previously marked
 * 🔴 manual on the grounds that "file-watch scope + reload policy need live
 * discovery". Both are now known:
 *
 *   - Watch scope (hooks/useWindowFileWatcher.ts): in workspace mode the
 *     workspace root is watched; OUTSIDE a workspace the active document's
 *     PARENT DIRECTORY is watched. A fixture opened from a temp dir is
 *     therefore covered — which is exactly the state this journey runs in
 *     (it skips when a workspace is open, like every other disk journey).
 *   - Reload policy (hooks/useExternalFileChanges.ts): "Clean docs auto-reload
 *     silently; dirty docs batch into one dialog."
 *
 * The DIRTY branch stays manual on purpose: it raises a native Tauri dialog,
 * and the harness safety model forbids this runner from triggering one — a
 * blocked modal would hang the single connection for every later journey.
 *
 * Why it matters: if auto-reload silently fails, the user edits a stale buffer
 * and the next save overwrites whatever the external tool (git checkout, a
 * formatter, another editor, a sync client) just wrote — their change is gone
 * with no warning. If auto-reload MERGES rather than replaces, the document is
 * corrupted with duplicated content.
 *
 * Readiness: the watcher is registered by a React effect after this document
 * becomes active, and registration is an async invoke. An earlier version slept
 * a guessed 1200ms and then wrote once — on a loaded machine that single event
 * can land before the watcher attaches and is then lost forever, failing the
 * journey for a timing reason rather than a product one. Instead this REWRITES
 * with a fresh sequence marker until one is observed: a missed early write is
 * simply superseded, so readiness is polled rather than assumed.
 *
 * Oracle: the newest content must be present, the ORIGINAL content ABSENT
 * (proves replace, not merge/append), and the tab must remain CLEAN (a reload
 * is not a user edit and must not fabricate unsaved-changes state, which would
 * prompt a spurious save-on-close).
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

const OVERALL_RELOAD_BUDGET_MS = 20000;
const PER_ATTEMPT_MS = 4000;

export default {
  name: "external-change-reloads-clean-doc",
  coverageRequired: true,

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    try {
      const filePath = join(fixture.dir, `journey-extchange-${fixture.stamp}.md`);
      const title = basename(filePath, ".md");
      const originalMarker = `original-body-${fixture.stamp}`;
      await writeFile(filePath, `# External Change Journey\n\n${originalMarker}\n`, "utf8");

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
            (t) => typeof t === "string" && t.includes(originalMarker),
            "original fixture content loaded into the editor"
          );

          // ---- External rewrites from THIS process until one is observed. ----
          const deadline = Date.now() + OVERALL_RELOAD_BUDGET_MS;
          let seq = 0;
          let observedMarker = null;
          while (!observedMarker && Date.now() < deadline) {
            seq += 1;
            const marker = `externally-rewritten-${fixture.stamp}-${seq}`;
            await writeFile(filePath, `# External Change Journey\n\n${marker}\n`, "utf8");
            try {
              await poll(
                () => getEditorText(client),
                (t) => typeof t === "string" && t.includes(marker),
                `auto-reload of external write #${seq}`,
                { timeoutMs: PER_ATTEMPT_MS, intervalMs: 200 }
              );
              observedMarker = marker;
            } catch {
              // Watcher not attached yet (or the event coalesced away) — the
              // next rewrite supersedes this one.
            }
          }
          if (!observedMarker) {
            throw new Error(
              `clean document never auto-reloaded after ${seq} external rewrite(s) in ` +
                `${OVERALL_RELOAD_BUDGET_MS}ms — the watcher did not deliver, or reload is broken.`
            );
          }
          ctx.log(`file rewritten externally while clean; auto-reload observed on write #${seq}`);

          // Replace, not merge: the superseded content must be gone.
          const text = await getEditorText(client);
          if (text.includes(originalMarker)) {
            throw new Error(
              `auto-reload MERGED instead of replacing — superseded content still present.\n` +
                `  editor: ${JSON.stringify(text.slice(0, 300))}`
            );
          }

          // A reload is not a user edit: the tab must still be clean.
          const tabs = await getTabs(client);
          const dirty = tabs.find((t) => t.id === fileTab.id)?.dirty;
          if (dirty !== false) {
            throw new Error(
              `auto-reload left the tab dirty (dirty=${JSON.stringify(dirty)}) — a reload is ` +
                `not a user edit and must not fabricate unsaved-changes state.`
            );
          }
          ctx.log("clean doc auto-reloaded: new content replaced old, tab still clean");
        });
      } finally {
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
