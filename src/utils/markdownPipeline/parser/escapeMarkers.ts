/**
 * Pre/post processors for VMark's custom escape markers.
 *
 * Users can write `\==`, `\++`, `\^`, `\~` to produce literal characters.
 * Because remark strips backslash escapes before our plugins run, we
 * swap those sequences for Unicode Private Use Area placeholders before
 * parsing, then convert the placeholders back to literal characters
 * after parsing.
 *
 * @module utils/markdownPipeline/parser/escapeMarkers
 */

import type { Root, Parent, Text } from "mdast";

/**
 * Escape placeholders for custom inline markers.
 * Uses Unicode Private Use Area to avoid conflicts with normal text.
 */
const ESCAPE_PATTERNS: Array<{ sequence: string; placeholder: string; restore: string }> = [
  { sequence: "\\==", placeholder: "\uE001\uE001", restore: "==" },
  { sequence: "\\++", placeholder: "\uE002\uE002", restore: "++" },
  { sequence: "\\^", placeholder: "\uE003", restore: "^" },
  { sequence: "\\~", placeholder: "\uE004", restore: "~" },
];

/**
 * Pre-process markdown to handle escaped custom markers.
 * Replaces \== \++ \^ \~ with Unicode placeholders before remark parsing.
 *
 * Important: Do NOT touch code spans or fenced code blocks. Backslash escapes
 * are literal inside code, and replacing them would corrupt code content.
 */
export function preprocessEscapedMarkers(markdown: string): string {
  let out = "";

  let inInlineCode = false;
  let inlineFenceLen = 0;

  let inFencedCodeBlock = false;
  let fencedChar: "`" | "~" | "" = "";
  let fencedLen = 0;

  const getLineEnd = (from: number): number => {
    const idx = markdown.indexOf("\n", from);
    return idx === -1 ? markdown.length : idx;
  };

  const getLineForFenceDetection = (line: string): string => {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
  };

  for (let i = 0; i < markdown.length; ) {
    const atLineStart = i === 0 || markdown[i - 1] === "\n";

    // Fenced code blocks are line-based; handle by copying whole lines verbatim.
    if (atLineStart && !inInlineCode) {
      const lineEnd = getLineEnd(i);
      const line = markdown.slice(i, lineEnd);
      const lineForDetect = getLineForFenceDetection(line);

      if (!inFencedCodeBlock) {
        const openMatch = lineForDetect.match(/^ {0,3}(`{3,}|~{3,})/);
        if (openMatch) {
          inFencedCodeBlock = true;
          fencedChar = openMatch[1][0] as "`" | "~";
          fencedLen = openMatch[1].length;

          out += line;
          if (lineEnd < markdown.length) out += "\n";
          i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
          continue;
        }
      } else {
        // fencedChar is always truthy when inFencedCodeBlock=true (invariant: set at open)
        const closeRe = new RegExp(
          `^ {0,3}\\${fencedChar}{${fencedLen},}(?=\\s|$)`
        );
        if (closeRe.test(lineForDetect)) {
          inFencedCodeBlock = false;
          fencedChar = "";
          fencedLen = 0;

          out += line;
          if (lineEnd < markdown.length) out += "\n";
          i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
          continue;
        }
      }

      if (inFencedCodeBlock) {
        out += line;
        if (lineEnd < markdown.length) out += "\n";
        i = lineEnd < markdown.length ? lineEnd + 1 : lineEnd;
        continue;
      }
    }

    // Dead path: the line-based fast path (above) always advances i to the next line start,
    // so atLineStart is always true when inFencedCodeBlock=true outside inline code.
    /* v8 ignore next 4 -- @preserve structurally unreachable: fenced block chars are always consumed by the line-based path at line-start; this char-by-char fallback cannot be reached in practice */
    if (inFencedCodeBlock) {
      out += markdown[i];
      i += 1;
      continue;
    }

    // Inline code spans (backticks). Copy verbatim while inside.
    if (markdown[i] === "`") {
      let runLen = 1;
      while (i + runLen < markdown.length && markdown[i + runLen] === "`") {
        runLen += 1;
      }

      if (!inInlineCode) {
        inInlineCode = true;
        inlineFenceLen = runLen;
      } else if (runLen === inlineFenceLen) {
        inInlineCode = false;
        inlineFenceLen = 0;
      }

      out += markdown.slice(i, i + runLen);
      i += runLen;
      continue;
    }

    if (inInlineCode) {
      out += markdown[i];
      i += 1;
      continue;
    }

    // Escaped markers outside code.
    if (markdown[i] === "\\") {
      const match = ESCAPE_PATTERNS.find(({ sequence }) =>
        markdown.startsWith(sequence, i)
      );
      if (match) {
        out += match.placeholder;
        i += match.sequence.length;
        continue;
      }
    }

    out += markdown[i];
    i += 1;
  }

  return out;
}

/** Restore placeholders back to literal marker characters in the parsed tree. */
export function restoreEscapedMarkers(tree: Root): void {
  visitAndRestoreText(tree);
}

function visitAndRestoreText(node: Root | Parent): void {
  /* v8 ignore next -- @preserve defensive guard: always called with Root or Parent nodes that have children; the guard protects against unexpected leaf nodes in future callers */
  if (!("children" in node) || !Array.isArray(node.children)) return;

  for (const child of node.children) {
    if (child.type === "text") {
      const textNode = child as Text;
      for (const { placeholder, restore } of ESCAPE_PATTERNS) {
        if (textNode.value.includes(placeholder)) {
          textNode.value = textNode.value.split(placeholder).join(restore);
        }
      }
    }
    if ("children" in child && Array.isArray((child as Parent).children)) {
      visitAndRestoreText(child as Parent);
    }
  }
}
