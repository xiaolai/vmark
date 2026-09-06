/**
 * Contained, authenticated serving of a workspace's local media.
 *
 * Purpose: make `![caption](picture.png)` in a note actually render.
 *
 * `/note/*` serves only paths the walker admitted, and the walker admits
 * markdown — so a local image resolved to `/note/picture.png` and returned 404
 * even with a valid session (audit 20260906, MCP-C03). Removing the index gate
 * would have been the wrong fix: that gate is what stops a direct `/note/` URL
 * reaching hidden, ignored or non-document files. Local media needs its own
 * route with its own, deliberately narrow, policy.
 *
 * The policy, and why each part is here:
 *   - **Containment** — the same realpath check `/note/` uses, so `..` and a
 *     symlink pointing out of the workspace are both refused.
 *   - **Extension allowlist** — an explicit media list, never "anything that is
 *     not markdown". A workspace holds `.env` files and private keys too.
 *   - **No hidden paths** — any segment starting with `.` is refused, matching
 *     the walker's own rule, so `.git/` and `.vmark/` stay unreachable.
 *   - **Files only** — a directory is not an asset.
 *
 * @coordinates-with createServer.ts — mounts this route and rewrites image URLs
 * @module server/assetRoute
 */
import path from "node:path";
import { promises as fs } from "node:fs";
import type { Context } from "hono";
import { containedAbsPath, realContainedPath } from "./pathContainment";

/**
 * Extensions this route will serve, with the content type to send.
 *
 * An allowlist, because the alternative — serving whatever is not markdown —
 * turns a rendering convenience into workspace-wide file disclosure.
 */
const ASSET_CONTENT_TYPES: Readonly<Record<string, string>> = Object.freeze({
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
});

/** The content type for `relPath`, or `null` when it is not a servable asset. */
export function assetContentType(relPath: string): string | null {
  const ext = path.extname(relPath).toLowerCase();
  return ASSET_CONTENT_TYPES[ext] ?? null;
}

/**
 * Whether any segment of `relPath` is hidden.
 *
 * Mirrors the walker's rule so `/asset/.git/config` cannot reach what
 * `/note/` refuses — and `.` / `..` segments count as hidden here too, which
 * is belt-and-braces alongside the containment check.
 */
export function hasHiddenSegment(relPath: string): boolean {
  return relPath.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Whether `url` names a local file rather than somewhere else entirely.
 *
 * Absolute paths, protocol-relative URLs, and anything carrying a scheme are
 * left exactly as the author wrote them.
 */
export function isLocalAssetUrl(url: string): boolean {
  if (!url) return false;
  if (url.startsWith("#")) return false;
  if (url.startsWith("/")) return false;
  if (url.startsWith("//")) return false;
  // A scheme (http:, data:, mailto:) — but not a Windows-looking drive letter,
  // which is not something a markdown author writes for a local image anyway.
  return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}

/**
 * The `/asset/` URL for an image written as `url` inside the note at
 * `noteRelPath`, carrying the session token.
 *
 * The token is embedded SERVER-SIDE rather than added by `kb.js`, because the
 * browser starts fetching images while the HTML is still parsing — long before
 * `DOMContentLoaded` could rewrite them. In the in-app iframe, where cookies
 * are blocked, a client-side rewrite would always lose the race.
 */
export function assetHref(
  noteRelPath: string,
  url: string,
  sessionToken: string
): string {
  const noteDir = path.posix.dirname(noteRelPath);
  // Split the author's own query/fragment off before resolving.
  const [pathPart, ...rest] = url.split(/(?=[?#])/);
  const suffix = rest.join("");

  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    decoded = pathPart;
  }

  const resolved = path.posix
    .normalize(noteDir === "." ? decoded : `${noteDir}/${decoded}`)
    .replace(/^\/+/, "")
    // Clamp to the workspace. A note lives inside the root, so any `..` still
    // standing after normalization climbs ABOVE it — meaningless as an asset
    // reference. The route refuses such a path anyway; not building one keeps
    // the two from disagreeing about what a URL means.
    .replace(/^(?:\.\.\/)+/, "");
  const encoded = resolved.split("/").map(encodeURIComponent).join("/");
  return `/asset/${encoded}?s=${encodeURIComponent(sessionToken)}${suffix}`;
}

/**
 * The `/asset/*` route handler for a workspace rooted at `root`.
 *
 * A factory rather than an inline closure in `createServer` so the policy and
 * its enforcement sit together, and so `createServer` stays under its size cap.
 */
export function createAssetHandler({ root }: { root: string }) {
  return async (c: Context): Promise<Response> => {
    const relRequest = c.req.path.slice("/asset/".length);
    let relDecoded: string;
    try {
      relDecoded = decodeURIComponent(relRequest);
    } catch {
      return c.json({ error: "invalid path" }, 400);
    }
    if (hasHiddenSegment(relDecoded)) return c.json({ error: "not found" }, 404);

    const contentType = assetContentType(relDecoded);
    // An unlisted extension is not "not found" by accident — it is refused.
    if (!contentType) return c.json({ error: "not found" }, 404);

    const abs = containedAbsPath(root, relRequest);
    if (!abs) return c.json({ error: "invalid path" }, 400);
    // realpath containment: refuses a symlink pointing out of the workspace.
    const real = await realContainedPath(root, abs);
    if (!real) return c.json({ error: "not found" }, 404);

    try {
      const stat = await fs.stat(real);
      if (!stat.isFile()) return c.json({ error: "not found" }, 404);
      const body = await fs.readFile(real);
      return c.body(body, 200, {
        "content-type": contentType,
        // No caching: a workspace file can change under the reader, and the
        // KB's own live-reload assumes it is looking at current bytes.
        "cache-control": "no-store",
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        return c.json({ error: "not found" }, 404);
      }
      // Surface a real read failure rather than masking it as 404 (grill H10).
      return c.json({ error: "read failed" }, 500);
    }
  };
}
