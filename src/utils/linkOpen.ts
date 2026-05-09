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
 *   - "filepath"  — anything else; resolved against the active doc's directory
 *
 * Fragment navigation in the *target* file (e.g. land at `#bar` after opening
 * `foo.md`) is not yet implemented; the file opens at its top.
 *
 * @coordinates-with src/lib/markdownLinkCheck/check.ts — reuses
 *   `resolveMarkdownUrl` for path resolution semantics
 * @coordinates-with src/hooks/useFileShortcuts.ts — handler for `open-file`
 * @coordinates-with src/plugins/linkPopup/tiptap.ts — Cmd+click entry point
 * @coordinates-with src/plugins/linkPopup/LinkPopupView.ts — popup open icon
 * @module utils/linkOpen
 */

import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useTabStore } from "@/stores/tabStore";
import { resolveMarkdownUrl } from "@/lib/markdownLinkCheck/check";
import { linkPopupError } from "@/utils/debug";

export type LinkKind = "fragment" | "external" | "filepath";

// Match a URI scheme: at least 2 alphanumeric chars before `:` so Windows
// drive letters (`C:`) are NOT classified as schemes.
const URI_SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;

// Match a Windows absolute path (drive letter + `\` or `/`).
const WINDOWS_DRIVE_RE = /^[A-Za-z]:[\\/]/;

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

/**
 * Resolve a filepath-kind href against the currently focused document and
 * emit `open-file` to open the target file in a tab. Returns true on a
 * successful emit, false if the link cannot be resolved (e.g. the active
 * tab is untitled and the href is relative).
 */
export async function openFilepathLink(href: string): Promise<boolean> {
  if (!href) return false;

  const currentWindow = getCurrentWebviewWindow();
  const activeTab = useTabStore.getState().getActiveTab(currentWindow.label);
  const sourcePath = activeTab?.filePath ?? null;

  // Strip fragment up front; the open-file event takes a plain path.
  const hashIdx = href.indexOf("#");
  const pathPart = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
  if (!pathPart) return false;

  let absolutePath: string;
  if (WINDOWS_DRIVE_RE.test(pathPart)) {
    // Windows absolute path — never base-prefix against the current doc;
    // resolveMarkdownUrl would mangle it into `/doc/dir/C:/...`.
    absolutePath = pathPart.replace(/\\/g, "/");
  } else if (sourcePath) {
    absolutePath = resolveMarkdownUrl(href, sourcePath);
  } else if (pathPart.startsWith("/")) {
    // Untitled doc with a POSIX absolute path: pass through.
    absolutePath = pathPart;
  } else {
    // Untitled doc with a relative path — nothing to resolve against.
    return false;
  }

  if (!absolutePath) return false;

  try {
    await currentWindow.emit("open-file", { path: absolutePath });
    return true;
  } catch (error) {
    linkPopupError("Failed to emit open-file:", error);
    return false;
  }
}
