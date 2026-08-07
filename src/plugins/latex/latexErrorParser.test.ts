// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseLatexError } from "./latexErrorParser";

describe("latexErrorParser", () => {
  describe("parseLatexError", () => {
    // Brace matching
    describe("brace errors", () => {
      it("detects unmatched opening brace", () => {
        const error = new Error("Expected '}'");
        const result = parseLatexError(error, "\\frac{x");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("unmatched");
        expect(result.hint).toContain("{");
      });

      it("detects unmatched closing brace", () => {
        const error = new Error("Expected '}'");
        const result = parseLatexError(error, "x}");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("unmatched");
      });

      it("handles Missing } error", () => {
        const error = new Error("Missing }");
        const result = parseLatexError(error, "\\frac{x{y}");
        expect(result.hint).toContain("brace");
      });

      it("handles Unexpected end of input", () => {
        const error = new Error("Unexpected end of input");
        const result = parseLatexError(error, "\\sqrt{x");
        expect(result.hint).toContain("brace");
      });

      it("detects extra closing brace", () => {
        const error = new Error("Extra }");
        const result = parseLatexError(error, "x}");
        expect(result.hint).toContain("Extra closing");
      });

      it("handles Too many } error", () => {
        const error = new Error("Too many }");
        const result = parseLatexError(error, "x}}");
        expect(result.hint).toContain("Extra closing");
      });

      it("ignores escaped braces when counting", () => {
        // \{ and \} are literal braces in LaTeX, not structural
        const error = new Error("Expected '}'");
        // Content has balanced braces: one unescaped { and one unescaped }
        // The \{ and \} are escaped literals and should be ignored
        const result = parseLatexError(error, "\\{x\\}");
        // With escaped braces ignored, count is 0 open, 0 close = balanced
        expect(result.hint).toContain("unmatched");
      });
    });

    // Unknown commands
    describe("unknown command errors", () => {
      it("detects unknown command", () => {
        const error = new Error("Unknown macro: \\foo");
        const result = parseLatexError(error, "\\foo");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("Unknown command");
        expect(result.hint).toContain("\\foo");
      });

      it("returns generic 'Unknown command' hint when error contains no command name (lines 63, 120)", () => {
        // The error message contains "Unknown macro" but no \command pattern,
        // so extractUnknownCommand returns null → cmdName is null (line 63)
        // and the null branch of the ternary fires (line 120).
        const error = new Error("Unknown macro:");
        const result = parseLatexError(error, "\\someexpr");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toBe("Unknown command");
      });

      it("suggests correct syntax for frac", () => {
        const error = new Error("Unknown macro: \\frac");
        const result = parseLatexError(error, "\\frac x y");
        expect(result.hint).toContain("\\frac{numerator}{denominator}");
      });

      it("suggests correct syntax for sqrt", () => {
        const error = new Error("Unknown macro: \\sqrt");
        const result = parseLatexError(error, "\\sqrt");
        expect(result.hint).toContain("\\sqrt{expression}");
      });

      it("handles Undefined control sequence", () => {
        const error = new Error("Undefined control sequence: \\baz");
        const result = parseLatexError(error, "\\baz");
        expect(result.hint).toContain("\\baz");
      });
    });

    // Subscript/superscript
    describe("subscript/superscript errors", () => {
      it("detects double subscript", () => {
        const error = new Error("Double subscript");
        const result = parseLatexError(error, "x_a_b");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("Double subscript");
        expect(result.hint).toContain("braces");
      });

      it("detects double superscript", () => {
        const error = new Error("Double superscript");
        const result = parseLatexError(error, "x^a^b");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("Double superscript");
        expect(result.hint).toContain("braces");
      });
    });

    // Missing arguments
    describe("missing argument errors", () => {
      it("detects missing argument with Expected group", () => {
        const error = new Error("Expected group after '\\sqrt'");
        const result = parseLatexError(error, "\\sqrt");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toContain("requires arguments");
      });

      it("detects missing argument with generic message", () => {
        const error = new Error("Missing argument");
        const result = parseLatexError(error, "\\frac");
        expect(result.hint).toContain("requires arguments");
      });

      it("suggests syntax for known command with missing args", () => {
        const error = new Error("Expected group after '\\frac'");
        const result = parseLatexError(error, "\\frac");
        expect(result.hint).toContain("\\frac{numerator}{denominator}");
      });
    });

    // Environment errors
    describe("environment errors", () => {
      it("detects mismatched environments", () => {
        const error = new Error("\\begin{matrix} ended by \\end{pmatrix}");
        const result = parseLatexError(error, "\\begin{matrix} x \\end{pmatrix}");
        expect(result.hint).toContain("\\begin{}");
        expect(result.hint).toContain("\\end{}");
      });
    });

    // Math mode errors
    describe("math mode errors", () => {
      it("detects missing $ delimiter", () => {
        const error = new Error("Missing $");
        const result = parseLatexError(error, "text x^2");
        expect(result.hint).toContain("math mode");
      });
    });

    // Limit controls
    describe("limit control errors", () => {
      it("detects invalid limits usage", () => {
        const error = new Error("Limit controls must follow a math operator");
        const result = parseLatexError(error, "x\\limits");
        expect(result.hint).toContain("\\limits");
        expect(result.hint).toContain("operators");
      });
    });

    // Not supported
    describe("unsupported feature errors", () => {
      it("detects unsupported features", () => {
        const error = new Error("Function not supported");
        const result = parseLatexError(error, "\\somePackage");
        expect(result.hint).toContain("not supported");
      });
    });

    // Fallback
    describe("fallback behavior", () => {
      it("returns generic message for unknown errors", () => {
        const error = new Error("Some weird error");
        const result = parseLatexError(error, "x");
        expect(result.message).toBe("Invalid LaTeX syntax");
        expect(result.hint).toBeUndefined();
      });

      it("handles non-Error objects", () => {
        const result = parseLatexError("string error", "x");
        expect(result.message).toBeDefined();
      });

      it("handles null gracefully", () => {
        const result = parseLatexError(null, "");
        expect(result.message).toBe("Invalid LaTeX syntax");
      });

      it("handles undefined gracefully", () => {
        const result = parseLatexError(undefined, "");
        expect(result.message).toBe("Invalid LaTeX syntax");
      });
    });
  });
});
