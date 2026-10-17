/**
 * Media Source Resolution
 *
 * Purpose: The one algorithm that turns a media `src` written in Markdown into
 * a URL the webview can load — for the inline image view, the Source-mode
 * preview and the block media node views alike.
 *
 * Pipeline: external URL -> returned verbatim; otherwise decode, then
 *   external URL (was bracketed/escaped) -> absolute path -> asset URL
 *   -> URI scheme -> refused -> unresolvable path -> caller's verdict
 *   -> relative path -> joined onto the document's directory -> asset URL
 *
 * Key decisions:
 *   - Here, not in `utils/`, because it needs Tauri (`convertFileSrc`, the
 *     path API); `plugins/shared/` is importable by plugins and services both.
 *   - What differs between callers is a parameter, not a copy: where the
 *     document path comes from, and what an unresolvable path gets.
 *   - A source carrying a URI SCHEME is always refused (""). It is not inert:
 *     `file:` addresses the disk and a custom scheme addresses whatever this
 *     app registered, `vmark-trusted://` included.
 *     See src/test/adversarialMediaSources.ts.
 *   - A path nothing here can resolve (it names a directory, is home-relative,
 *     or is empty) is inert — the webview resolves it against the app origin,
 *     never `file://`. The inline resolvers hand it back unchanged; the block
 *     media resolver refuses it. Both are existing, tested behaviour.
 *   - A `..` segment is ordinary path syntax and is resolved (#1433).
 *   - A relative path with no document to resolve against, or whose resolution
 *     fails, comes back unchanged: merely unresolved, not hostile.
 *   - Do NOT percent-encode before `convertFileSrc`: it already encodes the
 *     whole path, and encoding here would double-encode (#752).
 *   - A caller that resolves LATER (an image deferred to the viewport, #1565)
 *     takes `snapshotActiveFilePath()` first: read at resolution time, the
 *     active document may be the other pane of a split.
 *
 * @coordinates-with plugins/shared/mediaSecurity.ts — path classification
 * @coordinates-with plugins/shared/hostDocument.ts — the inline resolvers' document path
 * @coordinates-with services/media/resolveMediaSrc.ts — the block media resolver
 * @module plugins/shared/resolveMediaPath
 */

import { convertFileSrc } from "@tauri-apps/api/core";
import { dirname, join } from "@tauri-apps/api/path";
import { imageViewWarn, imagePreviewError } from "@/utils/debug";
import { decodeMarkdownUrl } from "@/utils/markdownUrl";
import { activeFilePathForCurrentWindow } from "./hostDocument";
import { hasUriScheme, isAbsolutePath, isExternalUrl, isRelativePath } from "./mediaSecurity";

/**
 * Normalize a filesystem path for use with Tauri's convertFileSrc():
 * Windows backslashes become forward slashes (tauri-apps/tauri#7970).
 */
export function normalizePathForAsset(path: string): string {
  return path.replace(/\\/g, "/");
}

/** What a caller decides about the source it is resolving. */
export interface MediaPathContext {
  /** Path of the document that owns the source, or null when it has none. May throw. */
  documentPath: () => string | null;
  /**
   * The verdict for a path that is not a resolvable media file (a directory,
   * a home-relative path, an empty string): hand it back, or refuse it ("").
   */
  unresolvablePath: "passthrough" | "refuse";
  /** A source was refused; `decodedSrc` is what was classified. */
  onRefused: (decodedSrc: string) => void;
  /** Resolving a relative path failed; the source is returned unchanged. */
  onError: (error: unknown) => void;
}

/** Resolve a media `src` to a loadable URL. See the module header for the rules. */
export async function resolveMediaPath(src: string, context: MediaPathContext): Promise<string> {
  // An already-usable external URL is returned VERBATIM, ahead of decoding:
  // `%20` is valid in a URL and decoding it would corrupt the request.
  if (isExternalUrl(src)) return src;

  // Markdown may carry %20 for spaces or angle-bracket syntax; the filesystem
  // needs the real path.
  const decodedSrc = decodeMarkdownUrl(src);

  // Classify AGAIN after decoding: angle brackets (`<https://…/a b.png>`) hide
  // the scheme from the check above.
  if (isExternalUrl(decodedSrc)) return decodedSrc;

  if (isAbsolutePath(decodedSrc)) {
    return convertFileSrc(normalizePathForAsset(decodedSrc));
  }

  if (hasUriScheme(decodedSrc)) {
    context.onRefused(decodedSrc);
    return "";
  }

  if (!isRelativePath(decodedSrc)) {
    if (context.unresolvablePath === "passthrough") return src;
    context.onRefused(decodedSrc);
    return "";
  }

  try {
    const documentPath = context.documentPath();
    if (!documentPath) return src;

    const docDir = await dirname(documentPath);
    const absolutePath = await join(docDir, decodedSrc.replace(/^\.\//, ""));
    return convertFileSrc(normalizePathForAsset(absolutePath));
  } catch (error) {
    context.onError(error);
    return src;
  }
}

/**
 * The current window's document path, read NOW and replayed later — a throw
 * included, so a deferred resolution reports it exactly as an immediate one.
 * A resolution deferred to the viewport must not follow focus to another pane.
 */
export function snapshotActiveFilePath(): () => string | null {
  try {
    const path = activeFilePathForCurrentWindow();
    return () => path;
  } catch (error) {
    return () => { throw error; };
  }
}

/**
 * Resolve an inline image `src` against the document in the current window,
 * or against `documentPath` when the caller took it earlier.
 * Used by both the WYSIWYG image view and the Source-mode image preview; the
 * document path comes from the `hostDocument` seam, so neither plugin names
 * the app's stores.
 */
export function resolveImageSrc(
  src: string,
  documentPath: () => string | null = activeFilePathForCurrentWindow,
): Promise<string> {
  return resolveMediaPath(src, {
    documentPath,
    unresolvablePath: "passthrough",
    onRefused: (decodedSrc) =>
      imageViewWarn("Rejected media source with an unsupported URI scheme:", decodedSrc),
    onError: (error) => imagePreviewError("Failed to resolve image path:", error),
  });
}
