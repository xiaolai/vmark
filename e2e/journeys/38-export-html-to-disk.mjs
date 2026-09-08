/**
 * Journey: export-html-to-disk
 *
 * The HTML export's promise (website/guide/export.md, WI-FL1.5): one export
 * writes BOTH `index.html` (external assets) and `standalone.html` (everything
 * embedded), plus the `assets/` the first one references. Nothing in the jsdom
 * tiers can prove that — the writer is plugin-fs, and the render is a real
 * off-screen tiptap surface — so this journey drives the live app's own render
 * and writer, then reads every file back FROM DISK in this Node process.
 *
 * HOW THE EXPORT IS TRIGGERED, and why not through `menu:export-html`.
 * `export.html` (services/commands/exportCommands.ts) → `exportToHtml`
 * (export/useExportOperations.ts) does exactly three things: it opens the
 * NATIVE save panel to get a folder, then runs `renderMarkdownToHtml` and
 * `exportHtml` on the active document's content. The panel is an NSSavePanel —
 * outside the webview, unreachable from `execute_js`, and there is no harness
 * seam for it (the export unit tests `vi.mock` plugin-dialog; the live app has
 * no such hook). So this journey performs the ONE step the panel would have
 * performed — choosing the folder — and calls the same two functions the
 * command calls, imported from the dev module graph the way
 * dev-docs/e2e-testing.md's store-import trick does. Both modules are stateless
 * (no store singletons), so the HMR module-identity caveat there does not apply.
 * `fontSettings` is deliberately omitted: a web-font setting would make the
 * writer download from a CDN, and a disk assertion must not depend on the
 * network.
 *
 * What is REAL here: the markdown is placed in the app through its own
 * `vmark.document.write` path and verified rendered before export; the render
 * is the app's ExportSurface; the writes are the app's plugin-fs calls under
 * the same `$HOME/**` scope users export into. Teardown removes the fixture
 * directory and force-closes the scratch tab, so nothing outlives the run.
 *
 * FIRE-AND-POLL, never one blocking script: the bridge enforces its own
 * per-script timeout (`execute_js failed: Script execution timeout`, ~5 s),
 * independent of the client-side timeout a caller passes. Render + write ran
 * inside a single call at first and took 5.8 s late in a full suite — under
 * 1 s standalone — so the bridge killed the script while the app carried on.
 * The export is therefore started asynchronously in the page, parks its
 * outcome on a run-scoped window slot, and Node `poll()`s that slot — the
 * same rule every wait in this suite follows.
 *
 * FOREGROUND, like the terminal journeys: the off-screen ExportSurface signals
 * ready from a frame callback, and WebKit suspends rAF in a backgrounded
 * window, so the render then only completes through its 15 s fallback —
 * measured 15997 ms unfocused against 1062 ms focused. The browser and
 * secondary-window journeys that run before this one move focus, so the
 * journey brings the app's own window to the front first rather than
 * inheriting whatever the previous journey left.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import {
  withTabRestore,
  createScratchTab,
  setEditorContent,
  getEditorText,
  poll,
} from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";

/** renderMarkdownToHtml waits for assets (≤ 10 s) inside a 15 s render budget. */
const EXPORT_TIMEOUT_MS = 40000;

/** Read a file the export must have written; a missing file is the failure. */
async function readExported(path, label) {
  try {
    const text = await readFile(path, "utf8");
    if (text.length === 0) throw new Error(`${label} was written EMPTY: ${path}`);
    return text;
  } catch (err) {
    if (err?.code === "ENOENT") throw new Error(`${label} was not written: ${path}`);
    throw err;
  }
}

function assertIncludes(haystack, needle, label) {
  if (!haystack.includes(needle)) {
    throw new Error(`${label} does not contain ${JSON.stringify(needle)}`);
  }
}

function assertExcludes(haystack, needle, label) {
  if (haystack.includes(needle)) {
    throw new Error(`${label} unexpectedly contains ${JSON.stringify(needle)}`);
  }
}

export default {
  name: "export-html-to-disk",

  async run(client, ctx) {
    const fixture = await makeAppTempDir();
    // The H1 is what `getExportFolderName` turns into the folder name; this one
    // needs no sanitising, so the folder IS the title.
    const title = `Export Journey ${fixture.stamp}`;
    const marker = `export-marker-${fixture.stamp}`;
    const markdown = `# ${title}\n\nexport body ${marker}\n`;
    // What the save panel would have returned, with its `.html` placeholder
    // already stripped (see exportToHtml).
    const outputPath = join(fixture.dir, title);

    try {
      await withTabRestore(client, async ({ track }) => {
        const scratch = await createScratchTab(client);
        track(scratch.id);

        // The document is REALLY in the app before anything is exported.
        await setEditorContent(client, markdown, { mustBeEmpty: true });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(marker),
          "scratch document to render in the editor"
        );
        ctx.log("scratch document established via vmark.document.write (dirty)");

        // Frontmost, so the render's ready signal is not parked in a suspended
        // rAF (see the header). The result is logged, never asserted: focus is
        // a precondition for speed, not the behaviour under test.
        const focused = await evalJs(
          client,
          `(async () => {
             try {
               await window.__TAURI__.window.getCurrentWindow().setFocus();
               await new Promise((r) => setTimeout(r, 200));
               return document.hasFocus();
             } catch (e) { return "focus failed: " + (e && e.message ? e.message : String(e)); }
           })()`
        );
        ctx.log(`window focus before export: ${focused}`);

        // The command's own render + writer, minus the native folder panel.
        // Started, not awaited: the outcome lands on a run-scoped slot that the
        // poll below reads (see the header on the bridge's script timeout).
        const slot = `__vmarkE2eExport_${fixture.stamp.replace(/[^a-z0-9]/gi, "_")}`;
        await evalJs(
          client,
          `(() => {
             const slot = ${JSON.stringify(slot)};
             window[slot] = { done: false };
             (async () => {
               try {
                 const { renderMarkdownToHtml } = await import("/src/export/renderMarkdownToHtml.ts");
                 const { exportHtml } = await import("/src/export/htmlExport.ts");
                 const html = await renderMarkdownToHtml(${JSON.stringify(markdown)}, true);
                 const result = await exportHtml(html, {
                   title: ${JSON.stringify(title)},
                   sourceFilePath: null,
                   outputPath: ${JSON.stringify(outputPath)},
                   forceLightTheme: true,
                 });
                 window[slot] = { done: true, ok: true, renderedLength: html.length, result };
               } catch (e) {
                 window[slot] = { done: true, ok: false, error: e && e.message ? e.message : String(e) };
               }
             })();
             return true;
           })()`
        );
        let outcome;
        try {
          outcome = await poll(
            async () => JSON.parse(await evalJs(client, `JSON.stringify(window[${JSON.stringify(slot)}] ?? null)`)),
            (v) => v?.done === true,
            "the app's render + export to finish",
            { timeoutMs: EXPORT_TIMEOUT_MS, intervalMs: 250 }
          );
        } finally {
          await evalJs(client, `(delete window[${JSON.stringify(slot)}], true)`).catch(() => {});
        }
        if (!outcome.ok) throw new Error(`export threw inside the app: ${outcome.error}`);
        const { result } = outcome;
        if (result.success !== true) {
          throw new Error(`exportHtml reported failure: ${result.error ?? JSON.stringify(result)}`);
        }
        if (result.indexPath !== `${outputPath}/index.html` || result.standalonePath !== `${outputPath}/standalone.html`) {
          throw new Error(
            `export result paths do not match the chosen folder: ${JSON.stringify(result)} (folder ${outputPath})`
          );
        }
        ctx.log(`app rendered ${outcome.renderedLength} chars and reported success (${result.totalSize}b written)`);

        // Ground truth: every file the export promises, read back in THIS process.
        const index = await readExported(join(outputPath, "index.html"), "index.html");
        const standalone = await readExported(join(outputPath, "standalone.html"), "standalone.html");
        const readerCss = await readExported(join(outputPath, "assets", "vmark-reader.css"), "assets/vmark-reader.css");
        const readerJs = await readExported(join(outputPath, "assets", "vmark-reader.js"), "assets/vmark-reader.js");

        // Both carry the document: the title and a REAL <h1> from `# …`, and
        // the paragraph marker.
        const h1 = new RegExp(`<h1\\b[^>]*>[^]*?${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^]*?</h1>`);
        for (const [label, html] of [["index.html", index], ["standalone.html", standalone]]) {
          assertIncludes(html, `<title>${title}</title>`, label);
          if (!h1.test(html)) throw new Error(`${label} has no <h1> carrying the document title`);
          assertIncludes(html, marker, label);
        }

        // index.html is the EXTERNAL-asset variant: it references the reader
        // files, and those references resolve to files that were written.
        assertIncludes(index, `<link rel="stylesheet" href="assets/vmark-reader.css">`, "index.html");
        assertIncludes(index, `<script src="assets/vmark-reader.js"></script>`, "index.html");

        // standalone.html is the EMBEDDED variant: no reference to assets/, and
        // the reader CSS/JS it embeds are byte-identical to the files index.html
        // links — one export, two packagings of the same thing.
        assertExcludes(standalone, "assets/vmark-reader", "standalone.html");
        assertIncludes(standalone, readerCss, "standalone.html (embedded reader CSS)");
        assertIncludes(standalone, readerJs, "standalone.html (embedded reader JS)");

        ctx.log(
          `both files on disk — index.html ${index.length}b (links assets/), ` +
            `standalone.html ${standalone.length}b (embeds ${readerCss.length}b CSS + ${readerJs.length}b JS)`
        );
      });
    } finally {
      await fixture.cleanup();
    }
  },
};
