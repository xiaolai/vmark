/**
 * Print document assembly (audit 20260907, #344/#345/#346).
 *
 * Purpose: the building blocks the print / native-PDF operations share, split
 * out of `useExportOperations.ts` so each is testable on its own —
 * `exportToPdfBrowser` had grown into one 81-line function that picked the
 * DOM source, inlined images, composed CSS and the HTML template, invoked IPC
 * and toasted, and `exportToPdfNative` repeated the render-then-inline half.
 *
 * Key decisions:
 *   - Local images are inlined as data URIs because the off-screen print
 *     webview has no Tauri asset:// handler (#999); remote http(s) URLs pass
 *     through untouched. Missing images raise ONE warning toast (#1086) — at
 *     this choke point, not at each caller, which is what made it one.
 *   - The live editor is the FOCUSED pane's WYSIWYG editor (editorStore's
 *     `active` slice, registered by useFocusedPaneTiptapRegistration), and
 *     only when it is registered for the tab being printed. Under document
 *     split (#1081) the DOM holds two `.ProseMirror` elements and
 *     `document.querySelector` returned the first whatever pane was focused,
 *     so printing from the right pane printed the left document. The DOM is
 *     never consulted (round 2): with the focused pane in Source mode nothing
 *     is registered, and the one editor left in the DOM is the OTHER pane's
 *     document. Without a registration for the active tab the caller renders
 *     that document's markdown, which is always the right document.
 *   - The print document always forces the light theme — dark backgrounds
 *     waste ink and look wrong on paper.
 *
 * @coordinates-with src/export/useExportOperations.ts — the operations that compose these
 * @coordinates-with src/export/resourceResolver.ts — image inlining
 * @coordinates-with src/export/htmlSanitizer.ts — the editor-artifact strip
 * @coordinates-with src/stores/editorStore.ts — the focused pane's editor
 * @module export/printDocument
 */

import { useEditorStore } from "@/stores/editorStore";
import { renderMarkdownToHtml } from "./renderMarkdownToHtml";
import { sanitizeExportHtml } from "./htmlSanitizer";
import { captureThemeCSS } from "./themeSnapshot";
import { warnMissingResources } from "./exportResourceWarnings";
import { contentHasMath } from "./fontEmbedder";

/**
 * Turn editor HTML into an export BODY: editor artifacts out, local images in
 * as data URIs, relative to the source document.
 *
 * The sanitize step is here because this is the one function every non-folder
 * export path goes through — print, native PDF and copy-as-HTML — and all
 * three shipped raw ProseMirror markup (audit R2, #690/#703): separators,
 * trailing breaks, hidden `.html-preview-*` placeholders, `contenteditable`.
 * The folder export has always sanitized; nothing else did. It runs BEFORE
 * resolution so a hidden placeholder's image is not fetched, and not warned
 * about, on its way to being deleted.
 */
export async function prepareExportBody(html: string, sourceFilePath: string | null): Promise<string> {
  const { resolveResources, getDocumentBaseDir } = await import("./resourceResolver");
  const baseDir = await getDocumentBaseDir(sourceFilePath);
  const { html: resolved, report } = await resolveResources(sanitizeExportHtml(html), {
    baseDir,
    mode: "single",
  });
  warnMissingResources(report);
  return resolved;
}

/** Render markdown light-themed through ExportSurface, then prepare its body. */
export async function renderPrintableHtml(markdown: string, sourceFilePath: string | null): Promise<string> {
  const rendered = await renderMarkdownToHtml(markdown, true);
  return prepareExportBody(rendered, sourceFilePath);
}

/**
 * The editor whose HTML may be printed live — the focused pane's WYSIWYG
 * editor, registered for `tabId` — or null when the caller should render that
 * document's markdown instead. See the header for why the DOM is never asked.
 */
export function liveEditorElement(tabId: string | null): Element | null {
  const { activeWysiwygEditor, activeWysiwygTabId } = useEditorStore.getState().active;
  if (!activeWysiwygEditor || tabId === null || activeWysiwygTabId !== tabId) return null;
  return activeWysiwygEditor.view.dom;
}

/**
 * Wrap rendered body HTML in the self-contained, light-theme print document.
 *
 * `expandDetails` runs here for the same reason the PDF template runs it: the
 * shared print CSS below styles `details[open] > *`, and Chromium/WebKit hide a
 * COLLAPSED element's contents with `content-visibility`, which no display
 * override reaches. A reader cannot click paper open, so a collapsed section
 * printed with its body missing — pure data loss, and this builder was the one
 * caller that composed the CSS without the markup step it depends on (audit
 * 20260907 round 2).
 */
export async function buildPrintHtml(bodyHtml: string): Promise<string> {
  const themeCSS = captureThemeCSS();
  const { getEditorContentCSS } = await import("./htmlExportStyles");
  const { getKatexCSS, getForceLightThemeCSS, getSharedContentCSS, expandDetails } = await import("./pdfHtmlTemplate");
  const printableBody = expandDetails(bodyHtml);
  // The KaTeX stylesheet carries its woff2 faces as base64 data URIs, so it is
  // the single largest thing this document can contain — and every print paid
  // for it, including the overwhelming majority with no math in them. The
  // folder export already decides this the same way (`includeKaTeX: hasMath`);
  // `contentHasMath` is that predicate, not a second one (audit round 3, #694).
  const katexCSS = contentHasMath(printableBody) ? getKatexCSS() : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Print</title>
  <style>
${katexCSS}
${themeCSS}
${getForceLightThemeCSS()}
${getEditorContentCSS()}

@page { margin: 1.5cm; }
body { background: var(--bg-color); color: var(--text-color); margin: 0; padding: 2em; }
${getSharedContentCSS()}
  </style>
</head>
<body>
  <div class="export-surface">
    <div class="export-surface-editor tiptap-editor">
${printableBody}
    </div>
  </div>
</body>
</html>`;
}
