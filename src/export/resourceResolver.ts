/**
 * Resource Resolver
 *
 * Handles image bundling and URL rewriting for export.
 * Resolves relative paths, copies local files, and rewrites URLs.
 */

import { readFile, copyFile, exists, mkdir, stat, lstat } from "@tauri-apps/plugin-fs";
import { basename, join } from "@tauri-apps/api/path";
import { isAssetUrl, resolveRelativePath } from "./resourcePaths";
import { uint8ArrayToBase64 } from "./fontEmbedder";
import { exportWarn } from "@/utils/debug";

/** Metadata for a single resource (image/asset) found during HTML export. */
interface ResourceInfo {
  /** Original src value from HTML */
  originalSrc: string;
  /** Resolved absolute path (for local files) */
  resolvedPath: string | null;
  /** New src to use in exported HTML */
  exportSrc: string;
  /** Whether the resource is remote (http/https) */
  isRemote: boolean;
  /** Whether the resource was found/accessible */
  found: boolean;
  /** File size in bytes (if known) */
  size?: number;
}

/** Summary report of all resources resolved during HTML export. */
export interface ResourceReport {
  /** All resources found in the document */
  resources: ResourceInfo[];
  /** Resources that were successfully resolved */
  resolved: ResourceInfo[];
  /** Resources that were not found */
  missing: ResourceInfo[];
  /** Total size of resolved resources */
  totalSize: number;
}

/** SVG placeholder used when an image cannot be embedded (missing, traversal-blocked, symlink, or unreadable). */
const MISSING_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect fill='%23f0f0f0' width='200' height='150'/%3E%3Ctext x='100' y='75' text-anchor='middle' fill='%23999' font-family='sans-serif' font-size='14'%3EImage not found%3C/text%3E%3C/svg%3E";

/** SVG placeholder used in folder mode when the source file exists but copy fails. */
const COPY_FAIL_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='150' viewBox='0 0 200 150'%3E%3Crect fill='%23f0f0f0' width='200' height='150'/%3E%3Ctext x='100' y='75' text-anchor='middle' fill='%23999' font-family='sans-serif' font-size='14'%3ECopy failed%3C/text%3E%3C/svg%3E";

/** Options for resource resolution during export. */
export interface ResolveOptions {
  /** Base directory for resolving relative paths (usually document directory) */
  baseDir: string;
  /**
   * Outermost directory an embedded resource may come from. Defaults to
   * `baseDir`, which is the document's own folder.
   *
   * Separate from `baseDir` on purpose: `baseDir` says where `../x.png`
   * resolves FROM, this says how far the result may reach. Collapsing them
   * would re-anchor every relative path (see `getExportContainmentRoot`).
   */
  containWithin?: string;
  /** Export mode: 'folder' creates assets/ subfolder, 'single' embeds as data URIs */
  mode: "folder" | "single";
  /** Output directory for folder mode (the document folder containing index.html) */
  outputDir?: string;
}

/**
 * Check if a URL is remote (http/https).
 */
export function isRemoteUrl(src: string): boolean {
  return src.startsWith("http://") || src.startsWith("https://");
}

/**
 * Check if a URL is a data URI.
 */
export function isDataUri(src: string): boolean {
  return src.startsWith("data:");
}

/**
 * Extract image sources from HTML content.
 */
export function extractImageSources(html: string): string[] {
  const sources: string[] = [];
  // Match double-quoted or single-quoted src separately so an apostrophe
  // inside a double-quoted value (e.g. Writer's Office) doesn't truncate the match.
  const imgRegex = /<img[^>]+src=(?:"([^"]+)"|'([^']+)')[^>]*>/gi;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const src = match[1] ?? match[2];
    if (src && !isDataUri(src)) {
      sources.push(src);
    }
  }

  return sources;
}

/**
 * Convert a file to a data URI.
 * Returns the data URI and the file size in bytes.
 */
export async function fileToDataUri(
  filePath: string
): Promise<{ dataUri: string; size: number } | null> {
  try {
    const data = await readFile(filePath);
    /* v8 ignore start -- split(".") always has ≥1 element, pop() is never undefined */
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    /* v8 ignore stop */
    const mimeType = getMimeType(ext);
    const base64 = uint8ArrayToBase64(data);
    return { dataUri: `data:${mimeType};base64,${base64}`, size: data.length };
  } catch (error) {
    exportWarn("Failed to read file for data URI:", filePath, error);
    return null;
  }
}

/**
 * Get MIME type for a file extension.
 */
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    ico: "image/x-icon",
    bmp: "image/bmp",
    avif: "image/avif",
  };
  return mimeTypes[ext] ?? "application/octet-stream";
}

/**
 * Resolve all resources in HTML content.
 *
 * For folder mode:
 * - Local files are copied to assets folder
 * - URLs are rewritten to relative paths
 *
 * For single mode:
 * - Local files are embedded as data URIs
 *
 * @param html - The HTML content to process
 * @param options - Resolution options
 * @returns Report of all resources and the modified HTML
 */
export async function resolveResources(
  html: string,
  options: ResolveOptions
): Promise<{ html: string; report: ResourceReport }> {
  const { baseDir, containWithin = baseDir, mode, outputDir } = options;
  const sources = extractImageSources(html);

  const resources: ResourceInfo[] = [];
  const resolved: ResourceInfo[] = [];
  const missing: ResourceInfo[] = [];
  let totalSize = 0;

  // Create images directory for folder mode
  // Structure: DocumentFolder/assets/images/
  const imagesDir =
    mode === "folder" && outputDir
      ? await join(outputDir, "assets", "images")
      : null;

  if (imagesDir) {
    try {
      const imagesDirExists = await exists(imagesDir);
      if (!imagesDirExists) {
        await mkdir(imagesDir, { recursive: true });
      }
    } catch (e) {
      exportWarn("Failed to create images directory:", e);
    }
  }

  let modifiedHtml = html;
  /** Track used filenames in folder mode to prevent overwrite collisions */
  const usedFileNames = new Set<string>();

  for (const src of sources) {
    const info: ResourceInfo = {
      originalSrc: src,
      resolvedPath: null,
      exportSrc: src,
      // Asset URLs are LOCAL files to inline, never remote passthrough (#1086).
      isRemote: isRemoteUrl(src) && !isAssetUrl(src),
      found: false,
    };

    // Skip remote URLs - keep as-is
    if (info.isRemote) {
      info.found = true;
      resources.push(info);
      resolved.push(info);
      continue;
    }

    // Resolve local path
    try {
      const resolvedPath = await resolveRelativePath(src, baseDir, containWithin);

      // Path traversal blocked — treat as missing.
      // Substitute the placeholder so the exported HTML doesn't carry the
      // original asset://localhost URL (broken outside VMark).
      if (resolvedPath === null) {
        info.found = false;
        info.exportSrc = MISSING_IMAGE_PLACEHOLDER;
        modifiedHtml = modifiedHtml.split(src).join(MISSING_IMAGE_PLACEHOLDER);
        resources.push(info);
        missing.push(info);
        continue;
      }

      info.resolvedPath = resolvedPath;

      // Check if file exists
      const fileExists = await exists(resolvedPath);
      if (!fileExists) {
        info.found = false;
        // Replace broken asset:// URLs with a transparent placeholder
        // This prevents browser errors from trying to load Tauri-specific URLs
        info.exportSrc = MISSING_IMAGE_PLACEHOLDER;
        modifiedHtml = modifiedHtml.split(src).join(MISSING_IMAGE_PLACEHOLDER);
        resources.push(info);
        missing.push(info);
        continue;
      }

      // Block symlinks to prevent traversal via symlink targets outside baseDir
      try {
        const fileStat = await lstat(resolvedPath);
        if (fileStat.isSymlink) {
          exportWarn(`Symlink traversal blocked: ${src}`);
          info.found = false;
          info.exportSrc = MISSING_IMAGE_PLACEHOLDER;
          modifiedHtml = modifiedHtml.split(src).join(MISSING_IMAGE_PLACEHOLDER);
          resources.push(info);
          missing.push(info);
          continue;
        }
      } catch {
        // lstat failure — treat as inaccessible
        info.found = false;
        info.exportSrc = MISSING_IMAGE_PLACEHOLDER;
        modifiedHtml = modifiedHtml.split(src).join(MISSING_IMAGE_PLACEHOLDER);
        resources.push(info);
        missing.push(info);
        continue;
      }

      info.found = true;

      if (mode === "single") {
        // Embed as data URI (returns size from the same read)
        const result = await fileToDataUri(resolvedPath);
        if (result) {
          info.exportSrc = result.dataUri;
          info.size = result.size;
          totalSize += result.size;
          modifiedHtml = modifiedHtml.split(src).join(result.dataUri);
        } else {
          // Read failed (permission denied, EIO, file lock, etc.). Mirror the
          // folder-mode copy-fail path so the exported HTML never carries an
          // asset:// URL that only resolves inside VMark (issue #907).
          info.found = false;
          info.exportSrc = MISSING_IMAGE_PLACEHOLDER;
          modifiedHtml = modifiedHtml.split(src).join(MISSING_IMAGE_PLACEHOLDER);
        }
      } else if (mode === "folder" && imagesDir) {
        // Copy to images folder, deduplicating filenames to prevent overwrites
        let fileName = await basename(resolvedPath);
        if (usedFileNames.has(fileName)) {
          const dotIndex = fileName.lastIndexOf(".");
          const name = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
          const ext = dotIndex > 0 ? fileName.slice(dotIndex) : "";
          let counter = 1;
          while (usedFileNames.has(`${name}-${counter}${ext}`)) {
            counter++;
          }
          fileName = `${name}-${counter}${ext}`;
        }
        usedFileNames.add(fileName);
        const destPath = await join(imagesDir, fileName);

        try {
          await copyFile(resolvedPath, destPath);
          // Relative path from index.html to assets/images/filename
          const relativePath = `assets/images/${fileName}`;
          info.exportSrc = relativePath;
          modifiedHtml = modifiedHtml.split(src).join(relativePath);
        } catch (e) {
          exportWarn(`Failed to copy ${resolvedPath}:`, e);
          info.found = false;
          // Replace with placeholder to avoid broken Tauri-internal URLs in exported HTML
          info.exportSrc = COPY_FAIL_PLACEHOLDER;
          modifiedHtml = modifiedHtml.split(src).join(COPY_FAIL_PLACEHOLDER);
        }

        // Use stat() to get size without re-reading the file
        try {
          const fileStat = await stat(resolvedPath);
          info.size = fileStat.size;
          totalSize += fileStat.size;
        } catch {
          // Size unknown - not critical, continue without it
        }
      }

      resources.push(info);
      if (info.found) {
        resolved.push(info);
      } else {
        missing.push(info);
      }
    } catch (e) {
      exportWarn(`Failed to resolve ${src}:`, e);
      info.found = false;
      resources.push(info);
      missing.push(info);
    }
  }

  return {
    html: modifiedHtml,
    report: {
      resources,
      resolved,
      missing,
      totalSize,
    },
  };
}

/**
 * Format file size for display.
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
