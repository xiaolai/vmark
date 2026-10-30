/**
 * Journey: pdf-export
 *
 * The PDF export's promise (website/guide/export.md, "Print / Export PDF"): on
 * macOS, Windows and Linux the document becomes a paginated PDF file carrying
 * a heading outline, with page numbers on by default at the bottom centre. The
 * jsdom tier (src/test/tier0/pdfExport.test.tsx) pins everything up to the
 * arguments the Rust `export_pdf` command receives; it cannot see what happens
 * after — the hidden native webview that lays the pages out (WKWebView /
 * WebView2 / WebKitGTK, src-tauri/src/pdf_export/renderer) and the two lopdf
 * passes that follow it (outline.rs, page_numbers.rs). So this journey drives
 * the live app's own render and its own Rust command, then reads the file back
 * FROM DISK in this Node process. It is the PDF counterpart of journey 38.
 *
 * HOW THE EXPORT IS TRIGGERED, and why not through `menu:export-pdf-native`
 * (hooks/useCommandBootstrap.ts maps that event to `export.pdfNative`).
 * `export.pdfNative` (services/commands/exportCommands.ts) → `exportToPdfNative`
 * (export/useExportOperations.ts) renders the markdown with `renderPrintableHtml`
 * and opens the Export PDF window; that window's Export button
 * (export/PdfExportDialog.tsx `handleExport`) asks the NATIVE save panel for a
 * path, composes the print document, and invokes `export_pdf`. The panel is the
 * OS's own (an NSSavePanel on macOS) — outside every webview, unreachable from
 * `execute_js`, with no harness seam. So this journey performs the ONE step the
 * panel would have performed — choosing the path, recorded through the
 * debug-build-only `debug_grant_export_target` exactly as the panel's answer is
 * recorded (src-tauri/src/export_target), since `export_pdf` writes no path the
 * calling webview did not choose — and calls the same functions
 * the two halves call, imported from the dev module graph: `renderPrintableHtml`, then
 * `buildPdfExportHtml` / `buildPageSpec` / `buildPageNumberSpec` over the same
 * theme and content CSS, then the real `export_pdf` command. The options are
 * the dialog's shipped defaults, restated here (they live in a `useState`
 * initialiser and cannot be imported); the jsdom tier is what pins those
 * defaults, this journey only needs A4 with page numbers on. The export window
 * itself is not opened: progress events addressed to it are a documented no-op
 * when it does not exist (renderer/progress.rs), and a second native window
 * would take focus away from the one under test.
 *
 * What is REAL: the markdown is placed in the app through its own
 * `vmark.document.write` path and verified rendered before export; the render
 * is the app's ExportSurface; the PDF is produced by the platform's native
 * webview and post-processed by the shipped Rust code; the bytes asserted are
 * the file's. What is NOT: the save panel, the export window's own page (jsdom
 * tier), and opening the result in the system viewer (deliberately skipped — a
 * journey must not launch another application).
 *
 * WHAT IS ASSERTED ABOUT THE FILE, and what is not. Structure: the `%PDF-`
 * header, the `%%EOF` trailer, a plausible size, and page objects. Pagination:
 * the document is far longer than one A4 page, so a native layout that really
 * ran yields at least two pages — a blank or truncated render yields one.
 * Post-processing, which lopdf writes uncompressed: one page-number stamp per
 * page reading 1..N, and the document's own headings as outline titles. The
 * BODY TEXT is not asserted: the native engines write page content into
 * compressed streams as glyph codes of embedded subset fonts, so reading it
 * back needs a ToUnicode-aware PDF text extractor — a dependency this suite
 * does not take. (The Rust smoke harness, src-tauri/src/bin/pdf_smoke, does
 * extract text.) The outline titles prove the headings reached the PDF, not
 * that their glyphs were drawn; the page count is the evidence of layout.
 *
 * No `platforms`: the renderer has a backend on every OS the runner can be on
 * (renderer/mod.rs selects macos / windows / linux by cfg), so there is no
 * platform on which this journey has nothing to cover. No skips either.
 *
 * FIRE-AND-POLL, as in journey 38: the bridge kills any single script after
 * ~5 s, and a markdown render plus a native PDF render does not fit in that. The
 * export is started asynchronously in the page, parks its outcome on a
 * run-scoped window slot, and Node `poll()`s the slot. The poll's budget covers
 * the render's own 15 s fallback plus the native render, and stays inside the
 * runner's 90 s per-journey cap. A bridge call that fails while the main
 * thread is inside the print pipeline becomes the polled value instead of an
 * exception, so the poll keeps waiting for the real outcome and a timeout
 * reports the last bridge error.
 *
 * FOREGROUND, as in journey 38: the off-screen ExportSurface signals ready from
 * a frame callback and WebKit suspends rAF in a backgrounded window, so the
 * app's window is brought to the front first. Focus is polled for, logged, and
 * never asserted — it is a precondition for speed, not the behaviour under test.
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

/** Markdown render (≤ 15 s fallback) + native render, inside the 90 s journey cap. */
const EXPORT_TIMEOUT_MS = 60000;
/** Paragraphs of filler: several A4 pages at the default 11pt, on any engine. */
const FILLER_PARAGRAPHS = 80;
/** A text-only document cannot be smaller than a font subset or larger than this. */
const MIN_PDF_BYTES = 1000;
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/**
 * Read the facts this journey asserts out of a PDF's raw bytes.
 *
 * `latin1` maps every byte to exactly one character, so the regexes below are
 * byte-exact over PDF syntax. Only UNCOMPRESSED syntax is read: object
 * dictionaries, and the streams lopdf adds (it never compresses what it writes;
 * nothing under src-tauri/src/pdf_export calls `compress`).
 */
function inspectPdf(bytes, headingTitles) {
  const raw = bytes.toString("latin1");
  return {
    size: bytes.length,
    header: raw.slice(0, 8),
    hasHeader: /^%PDF-\d\.\d/.test(raw),
    hasTrailer: /%%EOF\s*$/.test(raw),
    // `/Type /Page` (CoreGraphics, cairo, Skia) or `/Type/Page` (lopdf), never `/Pages`.
    pages: (raw.match(/\/Type\s*\/Page(?![A-Za-z])/g) ?? []).length,
    // page_numbers.rs: `/VMarkPageNo <size> Tf`, `<x> <y> Td`, `(<label>) Tj`.
    stamps: [...raw.matchAll(/\/VMarkPageNo\s+[\d.]+\s+Tf\s+-?[\d.]+\s+-?[\d.]+\s+Td\s+\(([^)]*)\)\s*Tj/g)].map(
      (m) => m[1]
    ),
    hasOutline: raw.includes("/Outlines"),
    // outline.rs writes an ASCII title as a literal string: `/Title(<text>)`.
    missingTitles: headingTitles.filter((title) => !raw.includes(`(${title})`)),
  };
}

export default {
  name: "pdf-export",

  async run(client, ctx) {
    const fixture = await makeAppTempDir();
    // ASCII headings on purpose: outline.rs keeps an ASCII title as a plain
    // literal, which is what makes it readable in the raw file. The body
    // carries the CJK, the code block and the table.
    const title = `PDF Journey ${fixture.stamp}`;
    const lastHeading = `Appendix ${fixture.stamp}`;
    const marker = `pdf-marker-${fixture.stamp}`;
    const filler = Array.from(
      { length: FILLER_PARAGRAPHS },
      (_, i) => `Paragraph ${i + 1} of the export journey, long enough to take a full line of an A4 page.`
    ).join("\n\n");
    const markdown =
      `# ${title}\n\npdf body ${marker} 中文段落。\n\n## Code\n\n\`\`\`js\nconst answer = 42;\n\`\`\`\n\n` +
      `## Table\n\n| Name | Count |\n| --- | --- |\n| apple | 3 |\n\n${filler}\n\n## ${lastHeading}\n\nThe end.\n`;
    const expectedHeadings = [title, "Code", "Table", lastHeading];
    // What the save panel would have returned.
    const outputPath = join(fixture.dir, `pdf-journey-${fixture.stamp}.pdf`);

    try {
      await withTabRestore(client, async ({ track }) => {
        const scratch = await createScratchTab(client);
        track(scratch.id);

        // The document is REALLY in the app before anything is exported.
        await setEditorContent(client, markdown, { mustBeEmpty: true });
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(marker) && t.includes(lastHeading),
          "scratch document to render in the editor"
        );
        ctx.log("scratch document established via vmark.document.write (dirty)");

        // Frontmost, so the render's ready signal is not parked in a suspended
        // rAF (see the header). Logged, never asserted.
        await evalJs(
          client,
          `window.__TAURI__.window.getCurrentWindow().setFocus().then(() => true, () => false)`
        );
        const focused = await poll(() => evalJs(client, `document.hasFocus()`), (v) => v === true, "window focus", {
          timeoutMs: 2000,
          intervalMs: 100,
        }).catch(() => false);
        ctx.log(`window focus before export: ${focused}`);

        // The two halves of the app's export, minus the native save panel.
        // Started, not awaited: the outcome lands on a run-scoped slot.
        const slot = `__vmarkE2ePdfExport_${fixture.stamp.replace(/[^a-z0-9]/gi, "_")}`;
        await evalJs(
          client,
          `(() => {
             const slot = ${JSON.stringify(slot)};
             window[slot] = { done: false, stage: "loading modules" };
             (async () => {
               try {
                 const { renderPrintableHtml } = await import("/src/export/printDocument.ts");
                 const { buildPdfExportHtml } = await import("/src/export/pdfHtmlTemplate.ts");
                 const { captureThemeCSS, isDarkTheme } = await import("/src/export/themeSnapshot.ts");
                 const { getEditorContentCSS } = await import("/src/export/htmlExportStyles.ts");
                 const { buildPageSpec } = await import("/src/export/pageSpec.ts");
                 const { buildPageNumberSpec, effectiveBottomMarginMm } = await import("/src/export/pdfOptions.ts");
                 // PdfExportDialog's shipped defaults (see the header).
                 const options = {
                   pageSize: "a4", orientation: "portrait",
                   marginTop: 25.4, marginRight: 25.4, marginBottom: 25.4, marginLeft: 25.4,
                   fontSize: 11, lineHeight: 1.6, cjkLetterSpacing: "0.05em",
                   latinFont: "system", cjkFont: "system", useEditorTheme: false,
                   pageNumberPosition: "bottom-center", pageNumberFormat: "plain", pageNumberSkipFirst: false,
                 };
                 window[slot] = { done: false, stage: "rendering markdown" };
                 const rendered = await renderPrintableHtml(${JSON.stringify(markdown)}, null);
                 const isDark = isDarkTheme();
                 const html = buildPdfExportHtml(rendered, captureThemeCSS(), getEditorContentCSS(), options, isDark);
                 const headings = [...new DOMParser().parseFromString(rendered, "text/html")
                   .querySelectorAll("h1, h2, h3, h4, h5, h6")]
                   .map((el) => ({ level: parseInt(el.tagName[1], 10), text: (el.textContent ?? "").trim() }))
                   .filter((h) => h.text.length > 0);
                 const page = buildPageSpec(options.pageSize, options.orientation, {
                   top: options.marginTop, right: options.marginRight,
                   bottom: effectiveBottomMarginMm(options), left: options.marginLeft,
                 });
                 const pageNumbers = buildPageNumberSpec(options, "Page {n} of {total}", isDark);
                 window[slot] = { done: false, stage: "recording the chosen path" };
                 const outputPath = await window.__TAURI__.core.invoke("debug_grant_export_target", {
                   kind: "pdf", path: ${JSON.stringify(outputPath)},
                 });
                 window[slot] = { done: false, stage: "native render" };
                 const outcome = await window.__TAURI__.core.invoke("export_pdf", {
                   html, outputPath, headings, page, pageNumbers,
                 });
                 window[slot] = {
                   done: true, ok: true, renderedLength: rendered.length, htmlLength: html.length,
                   headings: headings.map((h) => h.text), warnings: (outcome && outcome.warnings) || [],
                 };
               } catch (e) {
                 const text = e && e.message ? e.message : typeof e === "string" ? e : JSON.stringify(e);
                 window[slot] = { done: true, ok: false, stage: window[slot] && window[slot].stage, error: text };
               }
             })();
             return true;
           })()`
        );
        let outcome;
        try {
          outcome = await poll(
            async () => {
              try {
                return JSON.parse(await evalJs(client, `JSON.stringify(window[${JSON.stringify(slot)}] ?? null)`));
              } catch (err) {
                // The main thread may be inside the print pipeline; keep waiting.
                return { done: false, bridge: err?.message ?? String(err) };
              }
            },
            (v) => v?.done === true,
            "the app's render + export_pdf to finish",
            { timeoutMs: EXPORT_TIMEOUT_MS, intervalMs: 250 }
          );
        } finally {
          await evalJs(client, `(delete window[${JSON.stringify(slot)}], true)`).catch(() => {});
        }
        if (!outcome.ok) throw new Error(`export failed inside the app while ${outcome.stage}: ${outcome.error}`);
        // The app's render produced real headings, in document order.
        if (JSON.stringify(outcome.headings) !== JSON.stringify(expectedHeadings)) {
          throw new Error(
            `rendered headings ${JSON.stringify(outcome.headings)} are not the document's ${JSON.stringify(expectedHeadings)}`
          );
        }
        // Post-processing is best-effort in the app, and a warning is what its
        // dialog reports as "exported, but … could not be added".
        if (outcome.warnings.length > 0) {
          throw new Error(`export_pdf succeeded only partially: ${JSON.stringify(outcome.warnings)}`);
        }
        ctx.log(`app rendered ${outcome.renderedLength} chars, sent ${outcome.htmlLength} chars of HTML, no warnings`);

        // Ground truth: the file, read back in THIS process.
        let bytes;
        try {
          bytes = await readFile(outputPath);
        } catch (err) {
          if (err?.code === "ENOENT") throw new Error(`the PDF was not written: ${outputPath}`);
          throw err;
        }
        const pdf = inspectPdf(bytes, expectedHeadings);
        if (!pdf.hasHeader) throw new Error(`not a PDF — the file starts with ${JSON.stringify(pdf.header)}`);
        if (!pdf.hasTrailer) throw new Error("the PDF does not end with %%EOF (truncated write?)");
        if (pdf.size < MIN_PDF_BYTES || pdf.size > MAX_PDF_BYTES) {
          throw new Error(`implausible PDF size: ${pdf.size} bytes`);
        }
        if (pdf.pages < 2) {
          throw new Error(
            `expected a multi-page PDF from ${FILLER_PARAGRAPHS} paragraphs, found ${pdf.pages} page object(s) — ` +
              `the native layout did not paginate the document`
          );
        }
        // Page numbers are on by default: one stamp per page, reading 1..N.
        const expectedStamps = Array.from({ length: pdf.pages }, (_, i) => String(i + 1));
        const stamps = [...pdf.stamps].sort((a, b) => Number(a) - Number(b));
        if (JSON.stringify(stamps) !== JSON.stringify(expectedStamps)) {
          throw new Error(
            `page-number stamps ${JSON.stringify(pdf.stamps)} do not number ${pdf.pages} page(s) as 1..${pdf.pages}`
          );
        }
        // The outline carries the document's own headings.
        if (!pdf.hasOutline || pdf.missingTitles.length > 0) {
          throw new Error(
            `the PDF outline is missing ${pdf.hasOutline ? JSON.stringify(pdf.missingTitles) : "entirely (/Outlines)"}`
          );
        }

        ctx.log(
          `PDF on disk — ${pdf.size}b, ${pdf.pages} pages, stamped 1..${pdf.pages}, ` +
            `outline with ${expectedHeadings.length} headings (body text not asserted: compressed glyph streams)`
        );
      });
    } finally {
      await fixture.cleanup();
    }
  },
};
