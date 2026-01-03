/**
 * Word Tokenizer for Spell Checking
 *
 * Extracts words from ProseMirror document with their positions.
 * Skips code blocks, URLs, emails, and numbers.
 */

import type { Node as ProseMirrorNode } from "@milkdown/kit/prose/model";
import type { WordToken } from "./types";

/**
 * Regex to match words including contractions (don't, it's).
 * Uses Unicode letter category to support accented characters.
 */
const WORD_REGEX = /[\p{L}]+(?:[''][\p{L}]+)*/gu;

/**
 * Patterns to skip (URLs, emails, etc.)
 */
const SKIP_PATTERNS = [
  /https?:\/\/\S+/gi, // URLs
  /www\.\S+/gi, // www links
  /\S+@\S+\.\S+/gi, // Emails
  /\d+/g, // Numbers
];

/**
 * Node types to skip entirely (code blocks, inline code)
 */
const SKIP_NODE_TYPES = new Set(["code_block", "code", "codeBlock", "fence"]);

/**
 * Mark types that indicate code (inline code)
 */
const CODE_MARK_TYPES = new Set(["code", "inlineCode"]);

/**
 * Check if a node or its marks indicate it's code.
 */
function isCodeContent(node: ProseMirrorNode): boolean {
  if (!node.isText) return false;
  return node.marks.some((mark) => CODE_MARK_TYPES.has(mark.type.name));
}

/**
 * Replace skip patterns with spaces to preserve positions.
 */
function maskSkipPatterns(text: string): string {
  let masked = text;
  for (const pattern of SKIP_PATTERNS) {
    masked = masked.replace(pattern, (match) => " ".repeat(match.length));
  }
  return masked;
}

/**
 * Extract word tokens from a ProseMirror document.
 * Returns array of words with their document positions.
 */
export function tokenizeDocument(doc: ProseMirrorNode): WordToken[] {
  const tokens: WordToken[] = [];

  doc.descendants((node, pos) => {
    // Skip code blocks entirely
    if (SKIP_NODE_TYPES.has(node.type.name)) {
      return false; // Don't descend into children
    }

    // Process text nodes
    if (node.isText && node.text) {
      // Skip inline code
      if (isCodeContent(node)) {
        return;
      }

      const text = node.text;
      const maskedText = maskSkipPatterns(text);

      // Find all words in the text
      let match: RegExpExecArray | null;
      WORD_REGEX.lastIndex = 0; // Reset regex state

      while ((match = WORD_REGEX.exec(maskedText)) !== null) {
        const word = match[0];
        const startOffset = match.index;

        // Only include words of 2+ characters
        if (word.length >= 2) {
          tokens.push({
            word,
            from: pos + startOffset,
            to: pos + startOffset + word.length,
          });
        }
      }
    }
  });

  return tokens;
}

/**
 * Extract words from a text range within the document.
 * Useful for incremental checking of changed paragraphs.
 */
export function tokenizeRange(
  doc: ProseMirrorNode,
  from: number,
  to: number
): WordToken[] {
  const tokens: WordToken[] = [];

  doc.nodesBetween(from, to, (node, pos) => {
    // Skip code blocks entirely
    if (SKIP_NODE_TYPES.has(node.type.name)) {
      return false;
    }

    // Process text nodes
    if (node.isText && node.text) {
      // Skip inline code
      if (isCodeContent(node)) {
        return;
      }

      const text = node.text;
      const maskedText = maskSkipPatterns(text);

      let match: RegExpExecArray | null;
      WORD_REGEX.lastIndex = 0;

      while ((match = WORD_REGEX.exec(maskedText)) !== null) {
        const word = match[0];
        const startOffset = match.index;
        const wordFrom = pos + startOffset;
        const wordTo = pos + startOffset + word.length;

        // Only include words within the requested range
        if (wordFrom >= from && wordTo <= to && word.length >= 2) {
          tokens.push({
            word,
            from: wordFrom,
            to: wordTo,
          });
        }
      }
    }
  });

  return tokens;
}
