// @vitest-environment node
/**
 * Tests for ES2022 error wrapping in the markdown pipeline adapter.
 *
 * Verifies that parseMarkdown and serializeMarkdown properly wrap errors
 * using `new Error(message, { cause })` (ES2022) instead of unsafe casts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock internal pipeline modules to force errors
vi.mock("../parser", () => ({
  parseMarkdownToMdast: vi.fn(),
}));

vi.mock("../mdastToProseMirror", () => ({
  mdastToProseMirror: vi.fn(),
}));

vi.mock("../proseMirrorToMdast", () => ({
  proseMirrorToMdast: vi.fn(),
}));

vi.mock("../serializer", () => ({
  serializeMdastToMarkdown: vi.fn(),
}));

vi.mock("@/utils/perfLog", () => ({
  perfStart: vi.fn(),
  perfEnd: vi.fn(),
  perfMark: vi.fn(),
}));

import { parseMarkdown, serializeMarkdown } from "../adapter";
import { parseMarkdownToMdast } from "../parser";
import { mdastToProseMirror } from "../mdastToProseMirror";
import { proseMirrorToMdast } from "../proseMirrorToMdast";
import { serializeMdastToMarkdown } from "../serializer";

// Minimal schema mock — we only need it to pass through, errors are forced via mocks
const mockSchema = {} as Parameters<typeof parseMarkdown>[0];

// Minimal ProseMirror doc mock for serialize tests
function createMockDoc(childCount = 2, size = 100) {
  return {
    content: { childCount, size },
  } as Parameters<typeof serializeMarkdown>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseMarkdown error wrapping", () => {
  describe("cause preserves original error", () => {
    it("wraps Error with correct message prefix", () => {
      const original = new Error("remark exploded");
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw original;
      });

      expect(() => parseMarkdown(mockSchema, "# Hello")).toThrow(
        /\[MarkdownPipeline\] Parse failed: remark exploded/,
      );
    });

    it("sets cause to the original Error instance (same reference)", () => {
      const original = new Error("parser failure");
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw original;
      });

      try {
        parseMarkdown(mockSchema, "# Hello");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).cause).toBe(original);
      }
    });

    it("wrapped error is instanceof Error", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("boom");
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
      }
    });

    it("wrapped error has a stack trace", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("stack check");
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).stack).toBeDefined();
        expect((err as Error).stack).toContain("Error");
      }
    });
  });

  describe("cause works with non-Error values", () => {
    it.each([
      { label: "string", value: "something went wrong" },
      { label: "number", value: 42 },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
      { label: "boolean", value: false },
      { label: "object", value: { code: "ENOENT" } },
      { label: "array", value: [1, 2, 3] },
    ])("preserves $label as cause", ({ value }) => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw value;
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).cause).toBe(value);
      }
    });
  });

  describe("error message includes input context", () => {
    it("includes short input as preview", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        parseMarkdown(mockSchema, "short input");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain('Input preview: "short input"');
      }
    });

    it("truncates long input to 100 chars with ellipsis", () => {
      const longInput = "x".repeat(200);
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        parseMarkdown(mockSchema, longInput);
        expect.fail("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("x".repeat(100) + "...");
        expect(msg).not.toContain("x".repeat(101));
      }
    });

    it("does not add ellipsis for exactly 100 chars", () => {
      const exact100 = "y".repeat(100);
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        parseMarkdown(mockSchema, exact100);
        expect.fail("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain(`Input preview: "${exact100}"`);
        expect(msg).not.toContain("...");
      }
    });

    it("includes empty string preview for empty input", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        parseMarkdown(mockSchema, "");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain('Input preview: ""');
      }
    });
  });

  describe("message formatting for non-Error thrown values", () => {
    it("stringifies a thrown string in the message", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw "raw string error";
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(
          "[MarkdownPipeline] Parse failed: raw string error",
        );
      }
    });

    it("stringifies a thrown number in the message", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw 404;
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(
          "[MarkdownPipeline] Parse failed: 404",
        );
      }
    });
  });

  describe("edge cases", () => {
    it("handles original error with its own cause (nested cause chain)", () => {
      const rootCause = new Error("root cause");
      const midError = new Error("mid error", { cause: rootCause });
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw midError;
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        const wrapped = err as Error;
        // Direct cause is the midError
        expect(wrapped.cause).toBe(midError);
        // The chain is preserved: wrapped -> midError -> rootCause
        expect((wrapped.cause as Error).cause).toBe(rootCause);
      }
    });

    it("handles error with extra properties beyond message/stack", () => {
      const original = new Error("custom error");
      (original as Error & { code: string }).code = "CUSTOM_CODE";
      (original as Error & { details: object }).details = { key: "value" };
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw original;
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        // cause preserves the original object with all its properties
        const cause = (err as Error).cause as Error & { code: string; details: object };
        expect(cause).toBe(original);
        expect(cause.code).toBe("CUSTOM_CODE");
        expect(cause.details).toEqual({ key: "value" });
      }
    });

    it("handles input with special characters and unicode", () => {
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      const unicodeInput = '# 你好世界 — em-dash "quotes" <tags> \n\t\0';
      try {
        parseMarkdown(mockSchema, unicodeInput);
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("你好世界");
        expect((err as Error).cause).toBeInstanceOf(Error);
      }
    });

    it("handles circular reference as cause without crashing", () => {
      const circular: Record<string, unknown> = { name: "circular" };
      circular.self = circular;

      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw circular;
      });

      // Should not crash — ES2022 cause accepts any value
      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).cause).toBe(circular);
      }
    });

    it("handles very long error message", () => {
      const longMsg = "x".repeat(10000);
      vi.mocked(parseMarkdownToMdast).mockImplementation(() => {
        throw new Error(longMsg);
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(longMsg);
      }
    });

    it("wraps errors from mdastToProseMirror step too", () => {
      const mdastResult = { type: "root", children: [] };
      vi.mocked(parseMarkdownToMdast).mockReturnValue(mdastResult as ReturnType<typeof parseMarkdownToMdast>);

      const original = new Error("PM conversion failed");
      vi.mocked(mdastToProseMirror).mockImplementation(() => {
        throw original;
      });

      try {
        parseMarkdown(mockSchema, "test");
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(
          "[MarkdownPipeline] Parse failed: PM conversion failed",
        );
        expect((err as Error).cause).toBe(original);
      }
    });
  });
});

describe("serializeMarkdown error wrapping", () => {
  describe("cause preserves original error", () => {
    it("wraps Error with correct message prefix", () => {
      const original = new Error("serialize exploded");
      vi.mocked(proseMirrorToMdast).mockImplementation(() => {
        throw original;
      });

      expect(() => serializeMarkdown(mockSchema, createMockDoc())).toThrow(
        /\[MarkdownPipeline\] Serialize failed: serialize exploded/,
      );
    });

    it("sets cause to the original Error instance (same reference)", () => {
      const original = new Error("serializer failure");
      vi.mocked(proseMirrorToMdast).mockImplementation(() => {
        throw original;
      });

      try {
        serializeMarkdown(mockSchema, createMockDoc());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).cause).toBe(original);
      }
    });
  });

  describe("error message includes doc context", () => {
    it("includes node count and doc size", () => {
      vi.mocked(proseMirrorToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        serializeMarkdown(mockSchema, createMockDoc(5, 250));
        expect.fail("should have thrown");
      } catch (err) {
        const msg = (err as Error).message;
        expect(msg).toContain("Doc info: 5 nodes, size 250");
      }
    });

    it("includes zero counts for empty doc", () => {
      vi.mocked(proseMirrorToMdast).mockImplementation(() => {
        throw new Error("fail");
      });

      try {
        serializeMarkdown(mockSchema, createMockDoc(0, 0));
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain("Doc info: 0 nodes, size 0");
      }
    });
  });

  describe("cause works with non-Error values", () => {
    it.each([
      { label: "string", value: "raw error" },
      { label: "number", value: 500 },
      { label: "null", value: null },
      { label: "undefined", value: undefined },
    ])("preserves $label as cause", ({ value }) => {
      vi.mocked(proseMirrorToMdast).mockImplementation(() => {
        throw value;
      });

      try {
        serializeMarkdown(mockSchema, createMockDoc());
        expect.fail("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        expect((err as Error).cause).toBe(value);
      }
    });
  });

  describe("wraps errors from serializer step", () => {
    it("wraps errors thrown by serializeMdastToMarkdown", () => {
      const mdastResult = { type: "root", children: [] };
      vi.mocked(proseMirrorToMdast).mockReturnValue(mdastResult as ReturnType<typeof proseMirrorToMdast>);

      const original = new Error("serializer step failed");
      vi.mocked(serializeMdastToMarkdown).mockImplementation(() => {
        throw original;
      });

      try {
        serializeMarkdown(mockSchema, createMockDoc());
        expect.fail("should have thrown");
      } catch (err) {
        expect((err as Error).message).toContain(
          "[MarkdownPipeline] Serialize failed: serializer step failed",
        );
        expect((err as Error).cause).toBe(original);
      }
    });
  });
});

describe("regression: no unsafe Error casts in adapter", () => {
  it("adapter.ts does not contain 'as Error &' unsafe cast pattern", async () => {
    // Read the source file and verify the old pattern is gone
    const fs = await import("fs");
    const path = await import("path");
    const adapterPath = path.resolve(
      __dirname,
      "..",
      "adapter.ts",
    );
    const source = fs.readFileSync(adapterPath, "utf-8");

    // The old pattern: (wrapped as Error & { cause?: unknown }).cause = error
    expect(source).not.toContain("as Error &");
    expect(source).not.toContain("as Error&");

    // Verify the new ES2022 pattern is used
    expect(source).toContain("{ cause: error }");
  });
});
