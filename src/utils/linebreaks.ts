/**
 * Linebreak Normalization
 *
 * Purpose: Normalize line endings and hard break styles before saving.
 * Resolves user preference vs detected document convention, then transforms
 * the markdown content accordingly.
 *
 * Key decisions:
 *   - "preserve" preference defers to the document's detected style
 *   - New/unknown documents default to LF and two-spaces (widest compatibility)
 *   - Conversion skips fenced code blocks to avoid corrupting code content
 *
 * @coordinates-with utils/linebreakDetection.ts — provides the detection inputs
 * @module utils/linebreaks
 */

import type {
  HardBreakStyle,
  HardBreakStyleOnSave,
  LineEnding,
  LineEndingOnSave,
} from "@/utils/linebreakDetection";

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

export function normalizeHardBreaks(text: string, target: "backslash" | "twoSpaces"): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const hasFinalNewline = normalized.endsWith("\n");
  const lastIndex = hasFinalNewline ? lines.length - 1 : lines.length;

  let inFence = false;
  let fenceChar: "`" | "~" | null = null;
  let fenceLength = 0;

  for (let i = 0; i < lastIndex; i += 1) {
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

export function normalizeLineEndings(text: string, target: "lf" | "crlf"): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (target === "crlf") {
    return normalized.replace(/\n/g, "\r\n");
  }
  return normalized;
}
