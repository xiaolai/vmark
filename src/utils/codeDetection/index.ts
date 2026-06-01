/**
 * Code Detection Utilities
 *
 * Heuristics to detect if clipboard content looks like source code
 * and optionally detect the programming language.
 */

import { calculateCodeScore, detectLanguage } from "./scoring";

export interface CodeDetectionResult {
  isCode: boolean;
  language: string | null;
  confidence: "high" | "medium" | "low";
}

/**
 * Detect if the given text is likely source code.
 *
 * @param text - The text to analyze
 * @returns Detection result with confidence level
 */
export function detectCode(text: string): CodeDetectionResult {
  if (!text || text.trim().length < 10) {
    return { isCode: false, language: null, confidence: "low" };
  }

  const trimmed = text.trim();

  // Quick checks for obvious code
  // Check if it starts with a shebang
  if (/^#!\//.test(trimmed)) {
    return { isCode: true, language: "shell", confidence: "high" };
  }

  // Check for JSON/YAML structure
  if (/^\s*\{[\s\S]*\}\s*$/.test(trimmed) || /^\s*\[[\s\S]*\]\s*$/.test(trimmed)) {
    // Looks like JSON
    try {
      JSON.parse(trimmed);
      return { isCode: true, language: "json", confidence: "high" };
    } catch {
      // Not valid JSON, might still be code
    }
  }

  // Calculate general code score
  const codeScore = calculateCodeScore(trimmed);

  // Detect language
  const { language, score: langScore } = detectLanguage(trimmed);

  // Combine scores
  const totalScore = codeScore + langScore;

  // Determine if it's code based on scores
  if (totalScore >= 8) {
    return { isCode: true, language, confidence: "high" };
  } else if (totalScore >= 4) {
    return { isCode: true, language, confidence: "medium" };
  } else if (totalScore >= 2 && langScore > 0) {
    return { isCode: true, language, confidence: "low" };
  }

  return { isCode: false, language: null, confidence: "low" };
}

/**
 * Check if text should be pasted as a code block.
 * More conservative than detectCode - only returns true for high confidence.
 */
export function shouldPasteAsCodeBlock(text: string): { should: boolean; language: string } {
  const result = detectCode(text);

  // Only auto-convert with high confidence
  if (result.isCode && result.confidence === "high") {
    return { should: true, language: result.language || "" };
  }

  return { should: false, language: "" };
}
