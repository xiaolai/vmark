/**
 * Media Path Classification
 *
 * Decides what a media `src` written in Markdown IS — an external URL, an
 * absolute path, a resolvable relative path, or a source to refuse outright.
 *
 * What this module refuses, and why each refusal is real:
 *   - a URI SCHEME (`javascript:`, `file:`, `blob:`, `vmark-trusted://`, any
 *     custom one). Not inert: `file:` addresses the disk and a custom scheme
 *     addresses whatever this app registered for it.
 *   - a home-relative path (`~/…`), which no resolver here expands, so it
 *     would be joined onto the document directory as a literal `~` segment.
 *   - a path naming a DIRECTORY rather than a file — nothing can decode one.
 *
 * What it deliberately does NOT refuse: a `..` segment (#1433).
 *
 * `..` was rejected as a "path traversal attack" until 2026-09-19. It is not
 * one here, and the check was costing the common authoring layout —
 * `notes/report.md` referencing `../images/photo.png` — while buying no
 * containment at all, for a checkable reason: every resolver converts an
 * ABSOLUTE path on an earlier branch with no validation whatsoever, and the
 * asset protocol scope is `**` (`src-tauri/tauri.conf.json`). So the set of
 * files a document can address is identical with the check and without it —
 * a hostile document simply writes `/Users/you/.ssh/id_rsa` instead. Removing
 * it grants no capability that was not already granted; it only stops
 * punishing the honest case.
 *
 * Three of VMark's own subsystems already agreed `..` is ordinary path syntax,
 * which is what made the renderer the outlier rather than the rule:
 * `utils/imagePathDetection.ts` classifies a pasted `../images/photo.jpg` as a
 * relative path and inserts it, and `lib/markdownLinkCheck/check.ts` resolves
 * `..` and reports the link as VALID. The renderer then drew a broken
 * placeholder for a link its own linter had just passed.
 *
 * A real containment boundary would have to constrain the RESOLVED absolute
 * path — for every branch, absolute paths included — not the syntax of one
 * branch's input. That is a deliberate product decision about whether a
 * document may embed an image from outside its workspace, and it does not
 * exist today.
 *
 * @coordinates-with services/media/resolveMediaSrc.ts — the block-media resolver
 * @coordinates-with plugins/imageView/resolveSrc.ts — the WYSIWYG node view resolver
 * @coordinates-with plugins/imagePreview/resolveSrc.ts — the Source-mode preview resolver
 * @module plugins/shared/mediaSecurity
 */

import { imageViewWarn } from "@/utils/debug";

/**
 * Does this source carry a URI SCHEME (`http:`, `javascript:`, `file:`, a
 * custom one)? RFC 3986 scheme grammar, case-insensitive.
 *
 * Split out of `isRelativePath` because the two questions have different
 * answers when a resolver cannot classify a source. A path it fails to resolve
 * is inert — the webview resolves it against the APP origin, so it can never
 * reach the filesystem — and the resolvers deliberately hand such a path back
 * unchanged. A SCHEME is not inert: `file:` addresses the disk and a custom
 * scheme addresses whatever this app registered for it, `vmark-trusted://`
 * included. Handing one back put it straight into an element's `src`.
 *
 * One definition, because all three media resolvers need exactly this test and
 * a fourth copy of the regex is how they would drift apart.
 */
export function hasUriScheme(src: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(src.trim());
}

/**
 * Does this path name a DIRECTORY rather than a file?
 *
 * A media `src` has to name a file. `.`, `..`, `../`, `assets/` and
 * `img/..` all resolve to a directory, which no image, audio or video loader
 * can decode — so they are refused as degenerate rather than turned into an
 * element that is guaranteed to break.
 *
 * This is the check that keeps "allow `..` as a segment" from also meaning
 * "accept a bare `..`": the difference is whether a filename follows.
 */
function namesDirectory(path: string): boolean {
  const last = path.replace(/\\/g, "/").split("/").pop() ?? "";
  return last === "" || last === "." || last === "..";
}

/**
 * Check if a path is a relative path this app can resolve to a media FILE.
 *
 * Relative means: no URI scheme, not absolute, not home-relative, not
 * degenerate (empty/whitespace), and it names a file rather than a directory.
 *
 * A `..` segment is ORDINARY here and is resolved against the document's
 * directory — see the module header for why refusing it protected nothing.
 */
export function isRelativePath(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  // Reject any URI scheme (case-insensitive): http:, javascript:, blob:, etc.
  if (hasUriScheme(trimmed)) return false;
  if (isAbsolutePath(trimmed)) return false;
  // Reject home-relative paths (~/) — no resolver here expands `~`, so this
  // would be joined on as a literal segment.
  if (trimmed.startsWith("~/") || trimmed === "~") return false;
  // Reject anything that names a directory, including a bare `.` or `..`.
  if (namesDirectory(trimmed)) return false;
  return true;
}

/**
 * Check if a path is an absolute local file path.
 */
export function isAbsolutePath(src: string): boolean {
  return src.startsWith("/") || /^[A-Za-z]:/.test(src);
}

/**
 * Check if a path is an external URL (http/https/data) or Tauri asset URL.
 */
export function isExternalUrl(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("asset://") ||
    src.startsWith("tauri://")
  );
}

/**
 * The gate a resolver applies before joining a media path onto the document's
 * directory: may this source be resolved as a relative media file?
 *
 * Absolute paths are rejected HERE but not by the app — every resolver
 * converts them on an earlier branch, because an absolute path needs no
 * document directory to resolve against. This function's job is the relative
 * branch alone.
 *
 * It does NOT reject `..`; see the module header for the measurement behind
 * that (#1433).
 */
export function validateImagePath(src: string): boolean {
  // Reject absolute paths — not because they are unsafe (the resolvers accept
  // them one branch earlier), but because they are not this branch's input.
  if (isAbsolutePath(src)) return false;

  return isRelativePath(src);
}

/**
 * Sanitize and validate an image path.
 * Returns null if the path is invalid or malicious.
 */
export function sanitizeImagePath(src: string): string | null {
  if (!validateImagePath(src)) {
    imageViewWarn("Rejected suspicious image path:", src);
    return null;
  }
  return src;
}
