/**
 * Linebreak Normalization
 *
 * Purpose: Normalize line endings and hard break styles before saving, and
 * expose a soft-equality comparison that tolerates cloud-sync rewrites.
 * Resolves user preference vs detected document convention, then transforms
 * the markdown content accordingly.
 *
 * Key decisions:
 *   - "preserve" preference defers to the document's detected style
 *   - New/unknown documents default to LF and two-spaces (widest compatibility)
 *   - Conversion skips fenced code blocks to avoid corrupting code content
 *   - softContentEquals folds benign differences that cloud-sync daemons
 *     (OneDrive/iCloud/Dropbox) introduce without changing semantic content
 *
 * @coordinates-with utils/linebreakDetection.ts — provides the detection inputs
 * @coordinates-with hooks/useExternalFileChanges.ts — uses softContentEquals to
 *   suppress spurious external-change prompts from sync-daemon rewrites
 * @module utils/linebreaks
 */

import type {
  HardBreakStyle,
  HardBreakStyleOnSave,
  LineEnding,
  LineEndingOnSave,
} from "@/utils/linebreakDetection";

/** Resolve user preference and detected doc style into a concrete hard break style. */
export function resolveHardBreakStyle(
  docStyle: HardBreakStyle,
  preference: HardBreakStyleOnSave
): "backslash" | "twoSpaces" {
  // Explicit user preference takes priority
  if (preference === "backslash") return "backslash";
  if (preference === "twoSpaces") return "twoSpaces";
  // Preserve detected document style
  if (docStyle === "backslash") return "backslash";
  if (docStyle === "twoSpaces") return "twoSpaces";
  // Default to twoSpaces for new/unknown docs (wider compatibility)
  return "twoSpaces";
}

/** Resolve user preference and detected doc line ending into LF or CRLF. */
export function resolveLineEndingOnSave(
  docLineEnding: LineEnding,
  preference: LineEndingOnSave
): "lf" | "crlf" {
  if (preference === "lf") return "lf";
  if (preference === "crlf") return "crlf";
  return docLineEnding === "crlf" ? "crlf" : "lf";
}

function isFenceLine(line: string): { fenceChar: "`" | "~"; fenceLength: number } | null {
  const match = line.match(/^\s*([`~]{3,})/);
  if (!match) return null;
  const fence = match[1];
  const fenceChar = fence[0] as "`" | "~";
  return { fenceChar, fenceLength: fence.length };
}

/** Convert hard breaks between backslash and two-space styles, skipping fenced code blocks. */
export function normalizeHardBreaks(text: string, target: "backslash" | "twoSpaces"): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lastIndex = hasFinalNewline ? lines.length - 1 : lines.length;

  let inFence = false;
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (let i = 0; i < lastIndex; i += 1) {
    /* v8 ignore next -- @preserve loop bound i < lastIndex < lines.length guarantees lines[i] is defined */
    const line = lines[i] ?? "";
    const fence = isFenceLine(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceChar = fence.fenceChar;
        fenceLength = fence.fenceLength;
      } else if (fence.fenceChar === fenceChar && fence.fenceLength >= fenceLength) {
        inFence = false;
        fenceChar = null;
        fenceLength = 0;
      }
      continue;
    }

    if (inFence) continue;

    if (target === "twoSpaces") {
      const trimmedEnd = line.replace(/[ \t]+$/, "");
      if (trimmedEnd.endsWith("\\")) {
        lines[i] = `${trimmedEnd.slice(0, -1)}  `;
      }
      continue;
    }

    const trailingMatch = line.match(/[ \t]+$/);
    if (trailingMatch && trailingMatch[0].length >= 2) {
      const before = line.slice(0, -trailingMatch[0].length);
      if (before.trim().length > 0) {
        lines[i] = `${before}\\`;
      }
    }
  }

  return lines.join("\n");
}

/** Normalize all line endings in text to the target style (LF or CRLF). */
export function normalizeLineEndings(text: string, target: "lf" | "crlf"): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (target === "crlf") {
    return normalized.replace(/\n/g, "\r\n");
  }
  return normalized;
}

/**
 * Strip a leading UTF-8 BOM (U+FEFF), if present.
 * Cloud sync engines (OneDrive, iCloud, Dropbox) sometimes add or remove BOM
 * during background normalization without changing the semantic content.
 */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Compare two strings for "soft" content equality, ignoring differences that
 * cloud sync engines (OneDrive, iCloud, Dropbox, Syncthing) routinely introduce
 * during background rewrites:
 *
 *  - line endings (CRLF ↔ LF ↔ CR)
 *  - leading BOM (U+FEFF)
 *  - a single trailing newline (added or stripped)
 *
 * Returns `true` when both strings carry the same semantic content. Use this
 * in watcher paths to suppress spurious "file changed externally" prompts
 * caused by sync-daemon rewrites that don't alter what the user sees.
 *
 * Anything beyond these benign transforms (e.g. trailing-space trimming,
 * Unicode normalization) is *not* folded — those are real edits the user
 * deserves to know about.
 */
export function softContentEquals(a: string, b: string): boolean {
  if (a === b) return true;
  const normA = stripBom(a).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  const normB = stripBom(b).replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n$/, "");
  return normA === normB;
}
