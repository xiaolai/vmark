/**
 * The asset half of the HTML export: getting images and fonts into the staging
 * tree, and reporting back what the templates should reference them by.
 *
 * Purpose: `exportHtmlStaged` was one 196-line function that resolved
 * resources twice, downloaded fonts, assembled CSS, wrote every file,
 * published, rolled back and built two result objects (audit R3 #685/#689).
 * The branching lived almost entirely in the two units below — a font whose
 * primary CDN fails and whose fallback may or may not exist, a download that
 * rejects rather than returning nothing, two settings naming one family, a
 * resource that resolves in folder mode and fails when embedded — and those
 * branches could only be reached through a full export. They are now callable,
 * and typed, on their own.
 *
 * Both units take the staging surface rather than a path: writing a file and
 * RECORDING it are one step, and an unrecorded file is one publication never
 * moves (see `ExportStage.track`).
 *
 * @coordinates-with src/export/htmlExport.ts — the only consumer
 * @coordinates-with src/export/fontEmbedder.ts — font discovery, download and CSS
 * @coordinates-with src/export/resourceResolver.ts — image resolution and copying
 * @module export/htmlExportAssets
 */

import { mkdir, writeFile } from "@tauri-apps/plugin-fs";
import {
  downloadFont,
  fontDataToDataUri,
  generateEmbeddedFontCSS,
  generateLocalFontCSS,
  getKaTeXFontFiles,
  getUserFontFile,
  type EmbeddedFont,
  type FontFile,
} from "./fontEmbedder";
import { resolveResources } from "./resourceResolver";

/** One entry of a resolver report. Derived, because `resourceResolver` keeps the shape private. */
type ResourceInfo = Awaited<ReturnType<typeof resolveResources>>["report"]["missing"][number];

/** The staging surface these units need: where to write, and what to record. */
export interface AssetStage {
  readonly root: string;
  path(relative: string): string;
  track(relative: string): void;
}

/** The user's font choices, as `HtmlExportOptions` carries them. */
export interface FontSettings {
  fontFamily?: string;
  monoFontFamily?: string;
}

/** What the two resource passes produced, merged. */
export interface ResolvedResources {
  /** Body HTML for index.html — images point at `assets/images/`. */
  indexContent: string;
  /** Body HTML for standalone.html — local images embedded as data URIs. */
  standaloneContent: string;
  /** How many resources the folder pass saw. */
  resourceCount: number;
  /** Every source either pass could not resolve, keyed by original src. */
  missing: Map<string, ResourceInfo>;
  /** Bytes the resolver copied into the stage. */
  bytesWritten: number;
}

/** What font preparation produced. */
export interface PreparedFonts {
  /** `@font-face` CSS referencing the copied files — for index.html. */
  localCSS: string;
  /** `@font-face` CSS carrying data URIs — for standalone.html. */
  embeddedCSS: string;
  /** Bytes written under the stage. */
  bytesWritten: number;
  /** One entry per font that could not be downloaded. */
  warnings: string[];
}

/**
 * Resolve the document's images twice — once copied into the stage for
 * index.html, once embedded for standalone.html — and record the copies.
 *
 * The two reports are MERGED (#337): a resource can resolve as a file copy and
 * still fail to embed, so a missing set taken from either pass alone
 * under-reports. Only files the folder pass actually copied under
 * `assets/images/` are tracked; a remote image was never written, and a
 * placeholder is a data URI rather than a path (#336).
 */
export async function resolveExportResources(
  sanitizedHtml: string,
  baseDir: string,
  stage: AssetStage,
): Promise<ResolvedResources> {
  const { html: indexContent, report } = await resolveResources(sanitizedHtml, {
    baseDir,
    mode: "folder",
    outputDir: stage.root,
  });

  for (const r of report.resources) {
    if (!r.isRemote && r.found && r.exportSrc.startsWith("assets/images/")) {
      stage.track(r.exportSrc);
    }
  }

  const { html: standaloneContent, report: standaloneReport } = await resolveResources(
    sanitizedHtml,
    { baseDir, mode: "single" },
  );

  return {
    indexContent,
    standaloneContent,
    resourceCount: report.resources.length,
    missing: new Map(
      [...report.missing, ...standaloneReport.missing].map((r) => [r.originalSrc, r]),
    ),
    bytesWritten: report.totalSize,
  };
}

/**
 * Which font files this export needs.
 *
 * KaTeX's fonts ship only when the document HAS math — the templates default
 * to including KaTeX, which put a CDN stylesheet in index.html and the whole
 * payload in standalone.html for documents with none (#340). Each user family
 * contributes at most one file, and the document and monospace settings can
 * name the SAME family (#339), so the list is deduplicated by filename.
 */
function fontsForExport(hasMath: boolean, fontSettings?: FontSettings): FontFile[] {
  const fonts: FontFile[] = hasMath ? [...getKaTeXFontFiles()] : [];
  for (const family of [fontSettings?.fontFamily, fontSettings?.monoFontFamily]) {
    const file = family ? getUserFontFile(family) : null;
    if (file && !fonts.some((f) => f.filename === file.filename)) fonts.push(file);
  }
  return fonts;
}

/**
 * Download every font this export needs, write it into the stage, and build
 * both stylesheets.
 *
 * Downloads run in parallel — sequentially this is the slowest step in the
 * export — and are settled rather than awaited as a group, because one CDN
 * refusing must not abandon the fonts that did arrive. A download can fail two
 * ways and BOTH are reported: `downloadFont` returning nothing (the primary URL
 * and any fallback were both refused) and the promise rejecting outright.
 * Neither fails the export: a missing web font degrades to the system stack.
 */
export async function prepareExportFonts(
  hasMath: boolean,
  fontSettings: FontSettings | undefined,
  stage: AssetStage,
): Promise<PreparedFonts> {
  const wanted = fontsForExport(hasMath, fontSettings);
  const prepared: PreparedFonts = {
    localCSS: "",
    embeddedCSS: "",
    bytesWritten: 0,
    warnings: [],
  };
  if (wanted.length === 0) return prepared;

  await mkdir(stage.path("assets/fonts"), { recursive: true });

  const results = await Promise.allSettled(
    wanted.map(async (font) => {
      let data = await downloadFont(font.url);
      if (!data && font.fallbackUrl) data = await downloadFont(font.fallbackUrl);
      return { font, data };
    }),
  );

  const downloaded: FontFile[] = [];
  const embedded: EmbeddedFont[] = [];
  for (const result of results) {
    if (result.status === "rejected") {
      prepared.warnings.push(`Failed to download font: ${String(result.reason)}`);
      continue;
    }
    const { font, data } = result.value;
    if (!data) {
      prepared.warnings.push(`Failed to download font: ${font.filename}`);
      continue;
    }
    const relative = `assets/fonts/${font.filename}`;
    await writeFile(stage.path(relative), data);
    stage.track(relative);
    prepared.bytesWritten += data.length;
    downloaded.push(font);
    embedded.push({ file: font, dataUri: fontDataToDataUri(data) });
  }

  if (downloaded.length > 0) prepared.localCSS = generateLocalFontCSS(downloaded, "assets/fonts");
  if (embedded.length > 0) prepared.embeddedCSS = generateEmbeddedFontCSS(embedded);
  return prepared;
}
