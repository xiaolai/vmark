/**
 * LaTeX Error Parser
 *
 * Parses KaTeX error messages and provides helpful hints
 * for common LaTeX syntax errors.
 */

import { stringifyUnknown } from "@/utils/stringifyUnknown";

export interface LatexErrorResult {
  message: string;
  hint?: string;
}

/** Common commands with their correct syntax */
const COMMAND_HINTS: Record<string, string> = {
  frac: "\\frac{numerator}{denominator}",
  sqrt: "\\sqrt{expression} or \\sqrt[n]{expression}",
  sum: "\\sum_{lower}^{upper}",
  int: "\\int_{lower}^{upper}",
  lim: "\\lim_{x \\to value}",
  prod: "\\prod_{lower}^{upper}",
  binom: "\\binom{n}{k}",
  matrix: "\\begin{matrix} a & b \\\\ c & d \\end{matrix}",
  pmatrix: "\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}",
  bmatrix: "\\begin{bmatrix} a & b \\\\ c & d \\end{bmatrix}",
};

/**
 * Count occurrences of a character in a string, skipping escaped ones.
 * In LaTeX, \{ and \} are literal braces and shouldn't affect brace matching.
 */
function countChar(str: string, char: string): number {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === char && (i === 0 || str[i - 1] !== "\\")) {
      count++;
    }
  }
  return count;
}

/**
 * Check for unmatched braces in LaTeX content.
 */
function checkBraces(content: string): { unmatched: boolean; type?: "open" | "close" } {
  const opens = countChar(content, "{");
  const closes = countChar(content, "}");

  if (opens > closes) {
    return { unmatched: true, type: "open" };
  }
  if (closes > opens) {
    return { unmatched: true, type: "close" };
  }
  return { unmatched: false };
}

/**
 * Extract command name from an "Unknown macro" error.
 */
function extractUnknownCommand(errorMessage: string): string | null {
  // KaTeX format: "Unknown macro: \foo" or "Undefined control sequence: \foo"
  const match = errorMessage.match(/(?:Unknown macro|Undefined control sequence)[:\s]*\\(\w+)/i);
  return match ? match[1] : null;
}

/**
 * Parse a KaTeX error and return a helpful message with optional hint.
 */
export function parseLatexError(error: unknown, content: string): LatexErrorResult {
  // Handle non-Error objects
  if (!error) {
    return { message: "Invalid LaTeX syntax" };
  }

  const errorMessage = stringifyUnknown(error);

  // Check for unmatched braces
  if (
    errorMessage.includes("Expected '}'") ||
    errorMessage.includes("Missing }") ||
    errorMessage.includes("Unexpected end of input")
  ) {
    const braceCheck = checkBraces(content);
    if (braceCheck.unmatched) {
      return {
        message: "Invalid LaTeX syntax",
        hint: braceCheck.type === "open"
          ? "Check for unmatched { brace"
          : "Check for unmatched } brace",
      };
    }
    return {
      message: "Invalid LaTeX syntax",
      hint: "Check for unmatched { } braces",
    };
  }

  // Extra closing brace
  if (errorMessage.includes("Extra }") || errorMessage.includes("Too many }")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "Extra closing } brace found",
    };
  }

  // Unknown command
  if (
    errorMessage.includes("Unknown macro") ||
    errorMessage.includes("Undefined control sequence")
  ) {
    const cmdName = extractUnknownCommand(errorMessage);
    if (cmdName && COMMAND_HINTS[cmdName]) {
      return {
        message: "Invalid LaTeX syntax",
        hint: `Unknown command \\${cmdName}. Try: ${COMMAND_HINTS[cmdName]}`,
      };
    }
    return {
      message: "Invalid LaTeX syntax",
      hint: cmdName ? `Unknown command: \\${cmdName}` : "Unknown command",
    };
  }

  // Double subscript/superscript
  if (errorMessage.includes("Double subscript")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "Double subscript. Use braces: x_{a_b}",
    };
  }

  if (errorMessage.includes("Double superscript")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "Double superscript. Use braces: x^{a^b}",
    };
  }

  // Missing argument
  if (
    errorMessage.includes("Expected group") ||
    errorMessage.includes("Missing argument") ||
    errorMessage.includes("requires arguments")
  ) {
    // Try to identify which command
    const cmdMatch = errorMessage.match(/(?:after|for)\s+'?\\(\w+)/i);
    const cmdName = cmdMatch ? cmdMatch[1] : null;

    if (cmdName && COMMAND_HINTS[cmdName]) {
      return {
        message: "Invalid LaTeX syntax",
        hint: `\\${cmdName} requires arguments: ${COMMAND_HINTS[cmdName]}`,
      };
    }

    return {
      message: "Invalid LaTeX syntax",
      hint: "Command requires arguments in { }",
    };
  }

  // Missing $ (trying to use math in text mode or vice versa)
  if (errorMessage.includes("Missing $") || errorMessage.includes("math mode")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "Check math mode delimiters",
    };
  }

  // Environment mismatch
  if (
    errorMessage.includes("begin{") ||
    errorMessage.includes("end{") ||
    errorMessage.includes("environment")
  ) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "Check \\begin{} and \\end{} environments match",
    };
  }

  // Limit controls
  if (errorMessage.includes("Limit controls")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "\\limits only works after operators like \\sum, \\int",
    };
  }

  // Package/function not supported
  if (errorMessage.includes("not supported") || errorMessage.includes("not available")) {
    return {
      message: "Invalid LaTeX syntax",
      hint: "This LaTeX feature is not supported",
    };
  }

  // Generic fallback
  return { message: "Invalid LaTeX syntax" };
}
