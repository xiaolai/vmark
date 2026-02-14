/**
 * HTML Export
 *
 * Generates a document folder with:
 *
 *   DocumentName/
 *   |-- index.html           <- References external CSS/JS/images
 *   |-- standalone.html      <- All embedded (CSS, JS, images as data URIs)
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
 * - standalone.html: Everything embedded as data URIs — ideal for sharing a
 *   single file via email/chat without worrying about missing assets.
 *
 * This "both files" approach was chosen over separate export modes because:
 * 1. Users don't have to think about which mode to use
 * 2. The cost of generating both is minimal (same render, different packaging)
 * 3. Users can choose which file to use after export based on their needs
 *
 * @module export/htmlExport
 * @coordinates-with htmlSanitizer.ts — HTML cleanup before export
 * @coordinates-with htmlTemplates.ts — HTML page generation (index + standalone)
 * @coordinates-with htmlExportStyles.ts — CSS composition for exported documents
 * @coordinates-with fontEmbedder.ts — font downloading and embedding
 * @coordinates-with themeSnapshot.ts — theme CSS capture
 * @coordinates-with resourceResolver.ts — image/asset resolution
 * @coordinates-with reader/ — vmark-reader CSS/JS for interactive exports
 */

import { writeTextFile, writeFile, mkdir } from "@tauri-apps/plugin-fs";
import { captureThemeCSS, isDarkTheme } from "./themeSnapshot";
import { resolveResources, getDocumentBaseDir } from "./resourceResolver";
import {
  contentHasMath,
  getKaTeXFontFiles,
  getUserFontFile,
  downloadFont,
  generateLocalFontCSS,
  generateEmbeddedFontCSS,
  fontDataToDataUri,
  type FontFile,
  type EmbeddedFont,
} from "./fontEmbedder";
import { getReaderCSS, getReaderJS } from "./reader";
import { sanitizeExportHtml } from "./htmlSanitizer";
import { generateIndexHtml, generateStandaloneHtml } from "./htmlTemplates";
import { getEditorContentCSS } from "./htmlExportStyles";

// Re-export getEditorContentCSS so existing imports from "./htmlExport" still work
export { getEditorContentCSS } from "./htmlExportStyles";

export interface HtmlExportOptions {
  /** Document title */
  title?: string;
  /** Source file path (for resource resolution) */
  sourceFilePath?: string | null;
  /** Output folder path (the document folder) */
  outputPath: string;
  /** User font settings */
  fontSettings?: {
    fontFamily?: string;
    monoFontFamily?: string;
  };
  /** Force light theme even if editor is in dark mode */
  forceLightTheme?: boolean;
  /** Include interactive reader controls (default: true) */
  includeReader?: boolean;
}

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
 * - standalone.html (all embedded)
 * - assets/vmark-reader.css
 * - assets/vmark-reader.js
 * - assets/images/ (copied images)
 *
 * @param html - The rendered HTML content from ExportSurface
 * @param options - Export options
 * @returns Export result
 *
 * @example
 * ```ts
 * const result = await exportHtml(renderedHtml, {
 *   title: 'My Document',
 *   outputPath: '/path/to/MyDocument',
 * });
 * ```
 */
export async function exportHtml(
  html: string,
  options: HtmlExportOptions
): Promise<HtmlExportResult> {
  const {
    title = "Document",
    sourceFilePath,
    outputPath,
    fontSettings,
    forceLightTheme = true,
    includeReader = true,
  } = options;

  const warnings: string[] = [];
  let totalSize = 0;

  const indexPath = `${outputPath}/index.html`;
  const standalonePath = `${outputPath}/standalone.html`;
  const assetsPath = `${outputPath}/assets`;
  const imagesPath = `${assetsPath}/images`;

  try {
    // Create folder structure
    await mkdir(outputPath, { recursive: true });
    await mkdir(assetsPath, { recursive: true });
    await mkdir(imagesPath, { recursive: true });

    // Sanitize HTML - remove editor artifacts
    const sanitizedHtml = sanitizeExportHtml(html);

    // Resolve resources for index.html (external images)
    const baseDir = await getDocumentBaseDir(sourceFilePath ?? null);
    const { html: indexContent, report } = await resolveResources(sanitizedHtml, {
      baseDir,
      mode: "folder",
      outputDir: outputPath,
    });

    if (report.missing.length > 0) {
      warnings.push(`${report.missing.length} resource(s) not found`);
    }

    // Resolve resources for standalone.html (embedded images)
    const { html: standaloneContent } = await resolveResources(sanitizedHtml, {
      baseDir,
      mode: "single",
    });

    // Download and save fonts for offline use
    const fontsPath = `${assetsPath}/fonts`;
    const fontsToExport: FontFile[] = [];

    // Include KaTeX fonts if document has math
    if (contentHasMath(sanitizedHtml)) {
      fontsToExport.push(...getKaTeXFontFiles());
    }

    // Include user-selected fonts (if they're web fonts)
    if (fontSettings?.fontFamily) {
      const fontFile = getUserFontFile(fontSettings.fontFamily);
      if (fontFile) fontsToExport.push(fontFile);
    }
    if (fontSettings?.monoFontFamily) {
      const fontFile = getUserFontFile(fontSettings.monoFontFamily);
      if (fontFile) fontsToExport.push(fontFile);
    }

    // Download and save fonts
    let fontCSS = "";          // For index.html (references local files)
    let embeddedFontCSS = "";  // For standalone.html (data URIs)
    if (fontsToExport.length > 0) {
      await mkdir(fontsPath, { recursive: true });

      const downloadedFonts: FontFile[] = [];
      const embeddedFonts: EmbeddedFont[] = [];
      for (const font of fontsToExport) {
        const data = await downloadFont(font.url);
        if (data) {
          await writeFile(`${fontsPath}/${font.filename}`, data);
          totalSize += data.length;
          downloadedFonts.push(font);
          // Also create embedded version for standalone
          embeddedFonts.push({
            file: font,
            dataUri: fontDataToDataUri(data),
          });
        } else {
          warnings.push(`Failed to download font: ${font.filename}`);
        }
      }

      // Generate CSS pointing to local font files (for index.html)
      if (downloadedFonts.length > 0) {
        fontCSS = generateLocalFontCSS(downloadedFonts, "assets/fonts");
      }
      // Generate CSS with embedded data URIs (for standalone.html)
      if (embeddedFonts.length > 0) {
        embeddedFontCSS = generateEmbeddedFontCSS(embeddedFonts);
      }
    }

    // Generate CSS
    const themeCSS = captureThemeCSS();
    const contentCSS = getEditorContentCSS();
    const readerCSS = includeReader ? getReaderCSS() : "";
    const readerJS = includeReader ? getReaderJS() : "";

    // Determine theme
    const useDarkTheme = !forceLightTheme && isDarkTheme();

    // Write assets/vmark-reader.css
    if (includeReader) {
      await writeTextFile(`${assetsPath}/vmark-reader.css`, readerCSS);
      totalSize += new TextEncoder().encode(readerCSS).length;
    }

    // Write assets/vmark-reader.js
    if (includeReader) {
      await writeTextFile(`${assetsPath}/vmark-reader.js`, readerJS);
      totalSize += new TextEncoder().encode(readerJS).length;
    }

    // Generate and write index.html
    const indexHtml = generateIndexHtml(indexContent, {
      title,
      themeCSS,
      fontCSS,
      contentCSS,
      isDark: useDarkTheme,
    });
    await writeTextFile(indexPath, indexHtml);
    totalSize += new TextEncoder().encode(indexHtml).length;

    // Generate and write standalone.html (with embedded images and fonts)
    const standaloneHtml = generateStandaloneHtml(standaloneContent, {
      title,
      themeCSS,
      fontCSS: embeddedFontCSS || fontCSS, // Use embedded fonts for standalone
      contentCSS,
      readerCSS,
      readerJS,
      isDark: useDarkTheme,
    });
    await writeTextFile(standalonePath, standaloneHtml);
    totalSize += new TextEncoder().encode(standaloneHtml).length;

    return {
      success: true,
      indexPath,
      standalonePath,
      assetsPath,
      resourceCount: report.resources.length,
      missingCount: report.missing.length,
      totalSize,
      warnings,
    };
  } catch (error) {
    return {
      success: false,
      indexPath,
      standalonePath,
      assetsPath,
      resourceCount: 0,
      missingCount: 0,
      totalSize,
      warnings,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Copy HTML to clipboard.
 *
 * @param html - The rendered HTML content
 * @param includeStyles - Whether to include styles
 */
export async function copyHtmlToClipboard(
  html: string,
  includeStyles: boolean = false
): Promise<void> {
  const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");

  // Sanitize HTML first
  const sanitizedHtml = sanitizeExportHtml(html);

  if (includeStyles) {
    const themeCSS = captureThemeCSS();
    const contentCSS = getEditorContentCSS();
    const styledHtml = `<style>${themeCSS}\n${contentCSS}</style>\n${sanitizedHtml}`;
    await writeText(styledHtml);
  } else {
    await writeText(sanitizedHtml);
  }
}
