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
 *   - Relative paths are resolved against useWorkspaceStore.rootPath so
 *     clicking "src/main.ts" opens the correct absolute path.
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

/** Resolve a possibly-relative path against the workspace root.
 * Normalizes the result and rejects paths that escape the workspace via `..`. */
function resolvePath(raw: string): string {
  if (raw.startsWith("/")) return raw;
  const clean = raw.replace(/^\.\//, '');
  const root = useWorkspaceStore.getState().rootPath;
  if (!root) return clean;
  // Normalize to resolve .. segments, then verify prefix
  const resolved = new URL(clean, 'file://' + root + '/').pathname;
  if (!resolved.startsWith(root + '/') && resolved !== root) return clean;
  return resolved;
}

/**
 * Create a file link provider for the terminal.
 * Detects file paths in terminal output and opens them in the editor on click.
 */
export function createFileLinkProvider(
  term: Terminal,
  onActivate: (filePath: string) => void,
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

        const resolved = resolvePath(rawPath);

        links.push({
          range,
          text: resolved,
          activate: () => onActivate(resolved),
        });
      }

      callback(links.length > 0 ? links : undefined);
    },
  };
}
