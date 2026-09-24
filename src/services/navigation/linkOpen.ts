/**
 * Link Open Helpers
 *
 * Purpose: Classify link hrefs and resolve relative file links against the
 *   currently focused document so cross-file links (e.g. `../foo.md#bar`)
 *   can open the target file in a tab via the existing `open-file` window
 *   event.
 *
 * Three link kinds:
 *   - "fragment"  — `#anchor` (intra-document navigation)
 *   - "external"  — has a URI scheme like `https:`, `mailto:`, `file:`
 *   - "filepath"  — anything else: an absolute path (`/…`, `C:\…`) opens as
 *                   written, a relative one resolves against the active doc's
 *                   directory; a network (UNC) path is refused
 *
 * A `#fragment` is split from the path but PRESERVED — it rides on the
 * open-file payload so the receiver can land on the heading.
 *
 * @coordinates-with src/lib/markdownLinkCheck/check.ts — reuses
 *   `resolveMarkdownUrl` for path resolution semantics
 * @coordinates-with src/hooks/useOpenFileEvent.ts — handler for `open-file`
 * @coordinates-with src/plugins/linkPopup/tiptap.ts — Cmd+click entry point
 * @coordinates-with src/plugins/linkPopup/LinkPopupView.ts — popup open icon
 * @coordinates-with src/plugins/sourceLinkPopup/ — Source-mode Cmd+click and
 *   popup open, both through `openLinkTarget`
 * @module services/navigation/linkOpen
 */

import { resolveMarkdownUrl } from "@/lib/markdownLinkCheck/check";
import { linkPopupError } from "@/utils/debug";
import { emitOpenFileInCurrentWindow } from "./openFileEvent";

export type LinkKind = "fragment" | "external" | "filepath";

// Match a URI scheme: at least 2 alphanumeric chars before `:` so Windows
// drive letters (`C:`) are NOT classified as schemes.
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

/**
 * Classify an href into one of three buckets so the caller can route it to
 * the right open path.
 */
export function classifyHref(href: string): LinkKind {
  if (!href) return "filepath";
  if (href.startsWith("#")) return "fragment";
  if (URI_SCHEME_RE.test(href)) return "external";
  return "filepath";
}

/** Percent-decode a fragment; a malformed `%` sequence stays raw, as the
 *  path half does, rather than throwing out of an open. */
function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

/**
 * Resolve a filepath-kind href (see `resolveMarkdownUrl` for the path
 * semantics) and emit `open-file` to open the target file in a tab. Returns
 * true on a successful emit, false if the link cannot be resolved (e.g. the
 * source doc is untitled and the href is relative). Never rejects.
 *
 * `sourcePath` is passed in (rather than read from tabStore) so this
 * module stays a pure leaf utility per `.dependency-cruiser.cjs`'s
 * leaf-modules-stay-pure rule. Callers fetch the active document path
 * from their own store access.
 */
export async function openFilepathLink(
  href: string,
  sourcePath: string | null,
): Promise<boolean> {
  if (!href) return false;

  // Split the fragment off the path — the open-file event takes a plain path,
  // but it CARRIES the fragment so the receiver can land on the heading.
  const hashIdx = href.indexOf("#");
  const fragment = hashIdx >= 0 ? decodeFragment(href.slice(hashIdx + 1)) : "";

  // Absolute paths (POSIX, drive) open as written; relative ones resolve
  // against the source document, and are unopenable in an untitled one.
  // Network (UNC) paths are refused — see resolveMarkdownUrl.
  const absolutePath = resolveMarkdownUrl(href, sourcePath);
  if (!absolutePath) return false;

  try {
    await emitOpenFileInCurrentWindow(absolutePath, fragment || undefined);
    return true;
  } catch (error) {
    linkPopupError("Failed to emit open-file:", error);
    return false;
  }
}

/** Schemes always allowed to reach the OS opener. */
const SAFE_LINK_SCHEMES = ["http:", "https:", "mailto:"];

/**
 * Schemes a user setting can NEVER enable.
 *
 * `customLinkProtocols` is user data that lives in localStorage, so it can
 * arrive from an imported or synced settings blob rather than a deliberate
 * choice. Without this floor, one entry (`"javascript"`) turned every link
 * in every document into script execution — the allowlist was overridable
 * by the very input it was protecting against.
 */
const NEVER_OPENABLE_SCHEMES = new Set([
  "javascript:",
  "vbscript:",
  "data:",
  "file:",
  "blob:",
  "filesystem:",
  "about:",
  "view-source:",
  "jar:",
  "chrome:",
  "chrome-extension:",
]);

/**
 * Open an external link via the OS opener, iff its scheme is allowlisted:
 * the built-in safe schemes plus the user's configured custom protocols
 * (settings -> advanced -> customLinkProtocols). Blocks file:, javascript:,
 * smb:, and anything else a hostile document could plant (audit 20260612).
 * Returns true when the open was attempted.
 */
export async function openExternalLink(href: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    linkPopupError("Blocked malformed external link:", href);
    return false;
  }
  const { useSettingsStore } = await import("@/stores/settingsStore");
  const custom =
    useSettingsStore.getState().advanced.customLinkProtocols ?? [];
  if (NEVER_OPENABLE_SCHEMES.has(parsed.protocol.toLowerCase())) {
    linkPopupError("Blocked always-unsafe URL scheme:", parsed.protocol, href);
    return false;
  }
  const allowed =
    SAFE_LINK_SCHEMES.includes(parsed.protocol) ||
    custom.includes(parsed.protocol.replace(/:$/, ""));
  if (!allowed) {
    linkPopupError("Blocked unsafe URL scheme:", parsed.protocol, href);
    return false;
  }
  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(href);
  return true;
}

/**
 * Open a link by its kind — the one place that decision is made, so a file
 * path can never again reach the external opener, which rejects anything
 * without a scheme (#1448: Source mode's Cmd+click and popup "open" did
 * exactly that). A fragment goes to the caller's heading navigator (none:
 * no-op), a file path to a tab, a URL to the scheme-allowlisted OS opener.
 * Shared by the WYSIWYG and Source link controllers. Never rejects.
 */
export async function openLinkTarget(
  href: string,
  sourcePath: string | null,
  navigateToFragment: ((targetId: string) => boolean) | null,
): Promise<void> {
  if (!href) return;
  try {
    switch (classifyHref(href)) {
      case "fragment":
        navigateToFragment?.(href.slice(1));
        return;
      case "filepath":
        await openFilepathLink(href, sourcePath);
        return;
      case "external":
        await openExternalLink(href);
        return;
    }
  } catch (error) {
    linkPopupError("Failed to open link:", error);
  }
}
