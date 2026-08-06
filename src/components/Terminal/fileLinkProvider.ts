/**
 * fileLinkProvider
 *
 * Purpose: Detects file paths in terminal output and makes them clickable.
 * Absolute and relative paths with optional :line:col suffixes are matched
 * and resolved against the workspace root.
 *
 * Key decisions:
 *   - Only paths that look like real files (contain a slash and have an
 *     extension) are linked, reducing false positives on random output.
 *   - Relative paths resolve against the shell's live cwd (OSC 7, WI-2.3) when
 *     available, falling back to useWorkspaceStore.rootPath — so clicking
 *     "src/main.ts" opens the correct file even after the user `cd`s around.
 *   - Implements xterm's ILinkProvider interface for native hover + click
 *     behavior without custom DOM manipulation.
 *
 * @coordinates-with createTerminalInstance.ts — registers this as a link provider
 * @module components/Terminal/fileLinkProvider
 */
import type { Terminal, ILinkProvider, ILink, IBufferRange } from "@xterm/xterm";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Regex to match file paths in terminal output.
 * Captures absolute paths and relative paths with optional :line:col suffix.
 *
 * Examples:
 *   /Users/foo/bar.ts
 *   /Users/foo/bar.ts:10
 *   /Users/foo/bar.ts:10:5
 *   ./src/main.ts:3:12
 *   src/components/App.tsx
 */
const FILE_PATH_RE =
  /(?:^|\s)((?:\/[\w.@~-]+)+(?:\/[\w.@~-]+)*|\.{0,2}\/[\w.@~/-]+)(?::(\d+))?(?::(\d+))?/g;

/** Check if a path segment looks like a real file (has extension or is a known dir pattern). */
function looksLikeFilePath(path: string): boolean {
  // Must contain at least one slash and have a file extension
  return path.includes("/") && /\.\w{1,10}$/.test(path);
}

/**
 * Normalize a base directory for anchoring: drop trailing separators so `/w/`
 * and `/w` behave identically, but keep the filesystem root as `/` rather than
 * collapsing it to the empty string.
 */
export function normalizeBase(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

/** Resolve a possibly-relative path against a base directory.
 * Prefers the shell's live cwd (OSC 7, WI-2.3); falls back to the workspace
 * root. Returns null for a relative path with no base, or one that escapes the
 * base via `..` — so terminal output like `../../../etc/passwd` is NOT turned
 * into a clickable link (path-traversal guard).
 *
 * Resolution is plain segment arithmetic rather than `new URL(…, 'file://…')`
 * for two reasons (WI-1.5 / T6):
 *   - URL-based resolution produced a containment check of
 *     `resolved.startsWith(base + '/')`, which for `base === "/"` demanded a
 *     leading `//` and therefore rejected EVERY relative path once the shell
 *     `cd`-ed to the filesystem root.
 *   - URL normalization silently CLAMPS an over-long `..` run at the root
 *     (`../etc/passwd` → `/etc/passwd`), which a containment check then waves
 *     through. Counting net ascent refuses it explicitly instead. A path is
 *     bytes, not a URL, so this also removes the percent-encode/decode dance
 *     that `#`, `?`, spaces and CJK bases needed.
 */
export function resolvePath(raw: string, getCwd?: () => string | null): string | null {
  if (raw.startsWith("/")) return raw;
  // Live cwd wins over workspace root: a path like `./build/x.ts` is relative
  // to where the shell actually is, not where the workspace was opened.
  const rawBase = getCwd?.() ?? useWorkspaceStore.getState().rootPath;
  // No base to anchor a relative path → don't create a link we can't resolve.
  if (!rawBase) return null;
  const base = normalizeBase(rawBase);

  // Walk the relative segments, tracking depth BELOW the base. A `..` with
  // nothing left to pop means net ascent above the anchor → refuse.
  const rel: string[] = [];
  for (const seg of raw.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (rel.length === 0) return null;
      rel.pop();
      continue;
    }
    rel.push(seg);
  }
  if (rel.length === 0) return base;
  // Keep the base's own prefix verbatim (it may be a Windows drive path), and
  // avoid emitting a doubled separator when the base IS the root.
  return base === "/" ? `/${rel.join("/")}` : `${base}/${rel.join("/")}`;
}

/**
 * Create a file link provider for the terminal.
 * Detects file paths in terminal output and opens them in the editor on click.
 */
export function createFileLinkProvider(
  term: Terminal,
  onActivate: (filePath: string, line?: number, col?: number) => void,
  getCwd?: () => string | null,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) {
        callback(undefined);
        return;
      }

      const text = line.translateToString(true);
      const links: ILink[] = [];

      for (const match of text.matchAll(FILE_PATH_RE)) {
        const rawPath = match[1];
        if (!looksLikeFilePath(rawPath)) continue;

        // Find exact position in the line (match[0] may have leading whitespace)
        const matchStart = match.index + match[0].indexOf(rawPath);
        // Include :line:col suffix in the link text
        const fullMatch = match[0].trimStart();
        const matchEnd = matchStart + fullMatch.length;

        const range: IBufferRange = {
          start: { x: matchStart + 1, y: bufferLineNumber },
          end: { x: matchEnd + 1, y: bufferLineNumber },
        };

        const resolved = resolvePath(rawPath, getCwd);
        // Skip paths we can't safely anchor or that escape the base (traversal).
        if (!resolved) continue;
        // Carry the parsed :line:col through so the editor can jump there (WI-4.1).
        const line = match[2] ? parseInt(match[2], 10) : undefined;
        const col = match[3] ? parseInt(match[3], 10) : undefined;

        links.push({
          range,
          text: resolved,
          activate: () => onActivate(resolved, line, col),
        });
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
}
