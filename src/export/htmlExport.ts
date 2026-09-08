/**
 * HTML Export
 *
 * Generates a document folder with:
 *
 *   DocumentName/
 *   |-- index.html           <- References external CSS/JS/images
 *   |-- standalone.html      <- CSS, JS and LOCAL images embedded as data URIs
 *   +-- assets/
 *       |-- vmark-reader.css
 *       |-- vmark-reader.js
 *       +-- images/
 *           |-- image1.png
 *           +-- ...
 *
 * Architecture Decision:
 * We always produce BOTH index.html and standalone.html in a single export.
 * - index.html: Clean HTML with external asset references — ideal for hosting,
 *   editing in other tools, or when file size matters (images stay external).
 * - standalone.html: every LOCAL asset embedded as a data URI — one file to share.
 *   A REMOTE http(s) image stays a remote reference: it is not fetched or embedded.
 *
 * This "both files" approach was chosen over separate export modes because:
 * 1. Users don't have to think about which mode to use
 * 2. The cost of generating both is minimal (same render, different packaging)
 * 3. Users can choose which file to use after export based on their needs
 *
 * The export is TRANSACTIONAL (audit 20260907, #332/#334/#335) — see
 * `exportStaging.ts`: staged, published by rename, rolled back with backups if
 * a rename fails part way, serialized per destination within this webview and,
 * through a lock file, across windows.
 *
 * @module export/htmlExport
 * @coordinates-with exportStaging.ts — the staging tree, its transactional publish, the per-destination queue
 * @coordinates-with exportLock.ts — the lock that makes that queue hold across windows
 * @coordinates-with htmlSanitizer.ts — HTML cleanup before export
 * @coordinates-with htmlTemplates.ts — HTML page generation (index + standalone)
 * @coordinates-with htmlExportStyles.ts — CSS composition for exported documents
 * @coordinates-with htmlExportAssets.ts — the image and font units this orchestrates
 * @coordinates-with fontEmbedder.ts — font downloading and embedding
 * @coordinates-with themeSnapshot.ts — theme CSS capture
 * @coordinates-with resourceResolver.ts — image/asset resolution
 * @coordinates-with reader/ — vmark-reader CSS/JS for interactive exports
 */

import { writeTextFile, mkdir } from "@tauri-apps/plugin-fs";
import { captureThemeCSS, isDarkTheme } from "./themeSnapshot";
import { getDocumentBaseDir } from "./resourceResolver";
import { contentHasMath } from "./fontEmbedder";
import { prepareExportFonts, resolveExportResources } from "./htmlExportAssets";
import { getReaderCSS, getReaderJS } from "./reader";
import { sanitizeExportHtml } from "./htmlSanitizer";
import { generateIndexHtml, generateStandaloneHtml } from "./htmlTemplates";
import { getEditorContentCSS } from "./htmlExportStyles";
import { openStage, runExclusive, type ExportStage } from "./exportStaging";
import { errorMessage } from "@/utils/errorMessage";

/** Configuration for HTML folder export. */
export interface HtmlExportOptions {
  /** Document title */
  title?: string | undefined;
  /** Source file path (resource resolution); `| undefined` — unsaved docs have none. */
  sourceFilePath?: string | null | undefined;
  /** Output folder path (the document folder) */
  outputPath: string;
  /** User font settings */
  fontSettings?: {
    fontFamily?: string;
    monoFontFamily?: string;
  };
  /** Force light theme even if editor is in dark mode */
  forceLightTheme?: boolean;
}

/** Result of an HTML export operation including paths, counts, and diagnostics. */
export interface HtmlExportResult {
  /** Whether export succeeded */
  success: boolean;
  /** Path to index.html */
  indexPath: string;
  /** Path to standalone.html */
  standalonePath: string;
  /** Assets folder path */
  assetsPath: string;
  /** Number of resources processed */
  resourceCount: number;
  /** Number of missing resources */
  missingCount: number;
  /** Total size of exported files */
  totalSize: number;
  /** Warning messages */
  warnings: string[];
  /** Error message (if failed) */
  error?: string;
}

/**
 * Export HTML document to a folder.
 *
 * Creates:
 * - index.html (external CSS/JS references)
 * - standalone.html (local assets embedded; remote images stay remote)
 * - assets/vmark-reader.css
 * - assets/vmark-reader.js
 * - assets/images/ (copied images)
 *
 * @param html - The rendered HTML content from ExportSurface
 * @param options - Export options (`outputPath` is the document folder)
 * @returns Export result; `success: false` carries `error` rather than throwing
 */
export function exportHtml(html: string, options: HtmlExportOptions): Promise<HtmlExportResult> {
  return runExclusive(options.outputPath, () => exportHtmlStaged(html, options));
}

/** The paths and counters BOTH outcomes report, so a new field cannot reach one and miss the other. */
function resultShell(
  outputPath: string,
  totalSize: number,
  warnings: string[],
): Omit<HtmlExportResult, "success" | "resourceCount" | "missingCount"> {
  return {
    indexPath: `${outputPath}/index.html`,
    standalonePath: `${outputPath}/standalone.html`,
    assetsPath: `${outputPath}/assets`,
    totalSize,
    warnings,
  };
}

async function exportHtmlStaged(
  html: string,
  options: HtmlExportOptions
): Promise<HtmlExportResult> {
  const {
    title = "Document",
    sourceFilePath,
    outputPath,
    fontSettings,
    forceLightTheme = true,
  } = options;

  const warnings: string[] = [];
  let totalSize = 0;

  // Everything below is written under the stage and published at the end;
  // nothing at `outputPath` changes until every file exists (#334).
  let stage: ExportStage | null = null;
  const writeStaged = async (relative: string, text: string): Promise<void> => {
    await writeTextFile(stage!.path(relative), text);
    stage!.track(relative);
    totalSize += new TextEncoder().encode(text).length;
  };

  try {
    stage = await openStage(outputPath);
    await mkdir(stage.path("assets"), { recursive: true });

    // Sanitize HTML - remove editor artifacts
    const sanitizedHtml = sanitizeExportHtml(html);

    // Images, resolved twice — copied for index.html, embedded for standalone.
    // The bytes the resolver measured belong in the total, which counted only
    // what THIS module wrote — text and fonts (audit R2, #688).
    const baseDir = await getDocumentBaseDir(sourceFilePath ?? null);
    const resources = await resolveExportResources(sanitizedHtml, baseDir, stage);
    totalSize += resources.bytesWritten;
    if (resources.missing.size > 0) {
      warnings.push(`${resources.missing.size} resource(s) not found`);
    }

    // KaTeX ships only when the document has math — the templates default to
    // shipping it, which put a CDN stylesheet in index.html for documents with none.
    const hasMath = contentHasMath(sanitizedHtml);
    const fonts = await prepareExportFonts(hasMath, fontSettings, stage);
    totalSize += fonts.bytesWritten;
    warnings.push(...fonts.warnings);

    const themeCSS = captureThemeCSS();
    const contentCSS = getEditorContentCSS();
    const readerCSS = getReaderCSS();
    const readerJS = getReaderJS();

    const useDarkTheme = !forceLightTheme && isDarkTheme();

    // Write the reader assets — the reader always ships; the opt-out no
    // caller ever set was removed (WI-FL3.9).
    await writeStaged("assets/vmark-reader.css", readerCSS);
    await writeStaged("assets/vmark-reader.js", readerJS);

    // Generate and write index.html
    const indexHtml = generateIndexHtml(resources.indexContent, {
      title,
      themeCSS,
      fontCSS: fonts.localCSS,
      contentCSS,
      isDark: useDarkTheme,
      includeKaTeX: hasMath,
    });
    await writeStaged("index.html", indexHtml);

    // Generate and write standalone.html (with embedded images and fonts)
    const standaloneHtml = generateStandaloneHtml(resources.standaloneContent, {
      title,
      themeCSS,
      fontCSS: fonts.embeddedCSS || fonts.localCSS, // Use embedded fonts for standalone
      contentCSS,
      readerCSS,
      readerJS,
      isDark: useDarkTheme,
      includeKaTeX: hasMath,
    });
    await writeStaged("standalone.html", standaloneHtml);

    // Every file exists: replace the destination's files in one pass.
    await stage.publish();

    return {
      success: true,
      ...resultShell(outputPath, totalSize, warnings),
      resourceCount: resources.resourceCount,
      missingCount: resources.missing.size,
    };
  } catch (error) {
    // The staging tree, the lock, and the destination folder if this export
    // created it. Whatever was at `outputPath` before is as it was: either
    // nothing was published, or `publish` rolled itself back (#334/#335).
    await stage?.discard();

    return {
      success: false,
      ...resultShell(outputPath, totalSize, warnings),
      resourceCount: 0,
      missingCount: 0,
      error: errorMessage(error),
    };
  }
}
