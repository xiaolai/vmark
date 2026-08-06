/**
 * Journey: editor-ime-composition (WI-1.5)
 *
 * IME composition in the SHIPPING WKWebView — the one tier where the
 * composition path runs in the actual engine VMark ships (Playwright's
 * WebKit build is not this build; jsdom cannot compose at all). The
 * sequence is synthetic (compositionstart → marked-text DOM mutation +
 * input → compositionend, the ecosystem ceiling for scripted composition);
 * the REAL macOS input method belongs to the opt-in real-IME lane.
 *
 * Tier-0 discipline: assert identities only the intended path can produce —
 * app observables, not DOM echoes. A cancelled composition must leave the
 * tab CLEAN (a dirty flag is store state, not DOM), and a committed one
 * must dirty the tab and survive `menu:save` into exact on-disk bytes.
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
  readLineEndingPreference,
  expectedEol,
  poll,
} from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";

/**
 * One WHOLE composition as a single synchronous sequence inside the webview
 * (the MarkText technique). Splitting steps across evalJs calls lets the
 * app's own ticks redraw the editor between them, wiping the uncommitted
 * marked-text node — observed live: the commit then reconciles against a
 * paragraph that no longer contains it.
 */
const compositionScript = (updates, endData, { cancel = false } = {}) => `(() => {
  const block = [...document.querySelectorAll('.ProseMirror p')].at(-1);
  block.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
  const node = document.createTextNode('');
  block.appendChild(node);
  for (const text of ${JSON.stringify(updates)}) {
    block.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
    node.data = text;
    const sel = window.getSelection();
    sel.collapse(node, node.data.length);
    block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', data: text }));
  }
  ${cancel ? "if (node.isConnected) node.remove();" : ""}
  block.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: ${JSON.stringify(endData)} }));
  return block.textContent;
})()`;

export default {
  name: "editor-ime-composition",

  async run(client, ctx) {
    const root = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (root) {
      return { skip: `workspace open (${root}) — Finder-open of an outside file would spawn a new window` };
    }

    const fixture = await makeAppTempDir();
    const filePath = join(fixture.dir, `journey-ime-${fixture.stamp}.md`);
    const title = basename(filePath, ".md");
    const original = `# IME Journey\n\nime target ${fixture.stamp}\n`;
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
          (t) => typeof t === "string" && t.includes(`ime target ${fixture.stamp}`),
          "fixture content loaded into the editor"
        );

        // Focus the editor so composition targets it.
        await evalJs(client, `(() => { document.querySelector('.ProseMirror').focus(); return true; })()`);

        // ── Leg 1: a CANCELLED composition leaves the tab CLEAN ──────────
        await evalJs(client, compositionScript(["す"], "", { cancel: true }));
        const tabsAfterCancel = await poll(
          () => getTabs(client),
          (ts) => ts.some((t) => t.id === fileTab.id),
          "tabs readable after cancelled composition"
        );
        const cancelled = tabsAfterCancel.find((t) => t.id === fileTab.id);
        if (cancelled?.dirty) {
          throw new Error("a cancelled composition dirtied the tab — the document changed");
        }
        ctx.log("cancelled composition left the tab clean");

        // ── Leg 2: multi-step composition commits, dirties, saves ────────
        await evalJs(client, compositionScript(["ni", "你好"], "你好"));

        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes("你好"),
          "committed 你好 present in the live document"
        );
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === true,
          "committed composition marks the tab dirty"
        );
        ctx.log("composition committed into the document (tab dirty)");

        await emitMenu(client, "save", ctx.windowLabel);
        await poll(
          () => getTabs(client),
          (ts) => ts.find((t) => t.id === fileTab.id)?.dirty === false,
          "save to clear the dirty indicator"
        );

        // Ground truth: exact bytes from THIS process (journey 10's oracle).
        const preference = await readLineEndingPreference(client);
        const EOL = expectedEol("lf", preference);
        const expected = `# IME Journey${EOL}${EOL}ime target ${fixture.stamp}你好${EOL}`;
        const onDisk = await readFile(filePath, "utf8");
        if (onDisk !== expected) {
          throw new Error(
            `saved bytes do not match (lineEndingsOnSave="${preference}").\n` +
              `  expected (${expected.length}b): ${JSON.stringify(expected)}\n` +
              `  on disk  (${onDisk.length}b): ${JSON.stringify(onDisk)}`
          );
        }
        ctx.log(`composed text saved to disk — exact byte match (${onDisk.length}b)`);
      });
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
