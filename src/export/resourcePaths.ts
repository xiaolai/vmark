/**
 * Export Resource Paths
 *
 * Where an exported image's bytes may come from, and how a `src` becomes an
 * absolute path. Split out of `resourceResolver.ts` so the containment rules
 * sit together and can be read without the bundling machinery around them.
 *
 * Two directories, deliberately distinct (#1433):
 *   - the RESOLUTION base (`getDocumentBaseDir`) — where a relative `src`
 *     resolves from. Always the document's own folder, matching the renderer.
 *   - the CONTAINMENT root (`getExportContainmentRoot`) — how far the result
 *     may reach. The open workspace, or the document's folder when there is
 *     none.
 *
 * Collapsing the two would re-anchor every relative path in the document.
 *
 * @coordinates-with export/resourceResolver.ts — bundles what these resolve
 * @coordinates-with plugins/shared/mediaSecurity.ts — the renderer's far weaker classifier
 * @module export/resourcePaths
 */

import { dirname, join, normalize } from "@tauri-apps/api/path";
import { exportWarn } from "@/utils/debug";

/**
 * Check that `normalizedPath` is `normalizedBase` or sits under it, with a
 * separator boundary so a sibling directory like `/a/b-evil` cannot pass a
 * `/a/b` baseDir check via plain `startsWith`. Tries both POSIX and Windows
 * separators because Tauri's `normalize()` returns platform-native paths.
 */
export function isInsideBase(normalizedPath: string, normalizedBase: string): boolean {
  if (normalizedPath === normalizedBase) return true;
  return (
    normalizedPath.startsWith(normalizedBase + "/") ||
    normalizedPath.startsWith(normalizedBase + "\\")
  );
}

/**
 * Check if a URL is a Tauri asset URL — a LOCAL file served through Tauri's
 * protocol handler, not a remote resource. convertFileSrc() emits these as
 * `asset://localhost/…` (macOS/Linux WebKit) or `http(s)://asset.localhost/…`
 * (newer macOS/WebKit + Windows). Correct classification matters for inlining.
 */
export function isAssetUrl(src: string): boolean {
  return (
    src.startsWith("asset://") ||
    src.startsWith("tauri://") ||
    /^https?:\/\/asset\.localhost\//.test(src)
  );
}

/**
 * Resolve a media `src` to an absolute path the export may embed.
 *
 * Returns null if the result escapes `containWithin` — for any spelling of
 * the source, relative, absolute or `asset://`. That refusal is the boundary
 * described on `getExportContainmentRoot`.
 *
 * @param src - the source as written in the document, or as the renderer left it
 * @param baseDir - where a RELATIVE src resolves from (the document's folder)
 * @param containWithin - how far the result may reach; defaults to `baseDir`
 */
export async function resolveRelativePath(
  src: string,
  baseDir: string,
  containWithin: string = baseDir
): Promise<string | null> {
  // Handle absolute paths — must still be within the containment root
  if (src.startsWith("/")) {
    const normalizedPath = await normalize(src);
    const normalizedBase = await normalize(containWithin);
    if (!isInsideBase(normalizedPath, normalizedBase)) {
      exportWarn(`Absolute path traversal blocked: ${src}`);
      return null;
    }
    return normalizedPath;
  }

  // Handle asset URLs - extract the path, then validate against baseDir
  // Formats: asset://localhost/path (macOS/Linux), https://asset.localhost/path (Windows)
  if (isAssetUrl(src)) {
    try {
      const url = new URL(src);
      // Tauri's convertFileSrc() always encodes the whole absolute path via
      // encodeURIComponent, so url.pathname is exactly "/" + encoded(origPath).
      // Strip that one structural slash before decoding to recover the
      // original path verbatim — works for macOS ("/Users/..."), Windows
      // forward-slash ("C:/Users/..."), and Windows backslash paths.
      // Naively decoding url.pathname would produce "//Users/..." on macOS
      // (the encoded leading "/" becomes a second slash) which Tauri's
      // normalize() does not collapse, breaking the baseDir check below.
      const extractedPath = decodeURIComponent(url.pathname.slice(1));
      const normalizedPath = await normalize(extractedPath);
      const normalizedBase = await normalize(containWithin);
      if (!isInsideBase(normalizedPath, normalizedBase)) {
        exportWarn(`Asset URL path traversal blocked: ${src}`);
        return null;
      }
      return normalizedPath;
    } catch (error) {
      /* v8 ignore start -- @preserve reason: asset:// and https://asset.localhost/ URLs always parse successfully via new URL(); catch is defensive only */
      exportWarn("Failed to parse asset URL:", src, error);
      return null;
      /* v8 ignore stop */
    }
  }

  // Decode percent-encoded sequences before joining to catch encoded traversal
  const decodedSrc = decodeURIComponent(src);

  // Resolve relative to the DOCUMENT's directory, then contain the result.
  // These are two different directories whenever a workspace is open.
  const resolved = await join(baseDir, decodedSrc);
  const normalizedPath = await normalize(resolved);
  const normalizedBase = await normalize(containWithin);

  // Block path traversal: resolved path must stay within the containment root
  if (!isInsideBase(normalizedPath, normalizedBase)) {
    exportWarn(`Path traversal blocked: ${src}`);
    return null;
  }

  return normalizedPath;
}

/**
 * Get the document's base directory from its file path.
 *
 * This is where a relative `src` RESOLVES FROM, and it is always the
 * document's own directory — a markdown `../images/photo.png` means "up from
 * this document", exactly as the renderer reads it. Do not widen this to the
 * workspace: doing so silently re-anchors every relative image in the file.
 * The containment boundary is a separate question, answered by
 * `getExportContainmentRoot`.
 */
export async function getDocumentBaseDir(filePath: string | null): Promise<string> {
  if (!filePath) {
    // Return current working directory or home as fallback
    return "/";
  }
  return await dirname(filePath);
}

/**
 * The outermost directory an export may embed FROM.
 *
 * Everything `resolveRelativePath` embeds must land inside this directory —
 * the boundary that keeps a document from embedding, say, `~/.ssh/id_rsa` as a
 * data URI into an HTML file the user then SHARES. Unlike the renderer's path
 * check (see `plugins/shared/mediaSecurity.ts`), this one is real: it blocks
 * absolute paths too, so there is no syntax that walks around it.
 *
 * It is the WORKSPACE ROOT when the document lives inside an open workspace,
 * and the document's own directory otherwise.
 *
 * Why it is not simply the document's directory: the renderer resolves
 * `../images/photo.png` against the document's directory (#1433), so an export
 * confined to that directory substitutes a placeholder for an image the user
 * is looking at on screen. A shared assets folder beside a notes folder is the
 * standard layout, and both halves live in the workspace the user deliberately
 * opened — so the workspace is the honest boundary. Everything outside it is
 * still refused.
 *
 * **This is a containment root, NOT a resolution base.** Keeping the two apart
 * is load-bearing: feeding this value in as `baseDir` would re-anchor every
 * relative path in the document to the workspace root, quietly turning
 * `photo.png` beside the document into a lookup at the top of the workspace.
 *
 * The document must actually be INSIDE the root for the widening to apply —
 * widening to a root the document does not live under would hand the export
 * reach that opening the workspace never justified. `isInsideBase` is what
 * makes `/p-evil` not count as inside `/p`.
 *
 * @param filePath - the document being exported; null for an unsaved buffer
 * @param workspaceRoot - the open workspace root, or null/empty when none
 */
export async function getExportContainmentRoot(
  filePath: string | null,
  workspaceRoot?: string | null,
): Promise<string> {
  const docDir = await getDocumentBaseDir(filePath);
  if (!workspaceRoot || !filePath) return docDir;

  const normalizedRoot = await normalize(workspaceRoot);
  const normalizedDocDir = await normalize(docDir);
  return isInsideBase(normalizedDocDir, normalizedRoot) ? normalizedRoot : docDir;
}
