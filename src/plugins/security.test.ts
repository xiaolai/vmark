/**
 * Security Tests for Plugins
 *
 * TDD: These tests verify that security vulnerabilities are fixed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock mermaid before importing
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>test</svg>" }),
  },
}));

// Mock katex before importing
vi.mock("katex", () => ({
  default: {
    renderToString: vi.fn().mockReturnValue("<span>rendered</span>"),
  },
}));

describe("Security: Mermaid", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("should initialize mermaid with antiscript securityLevel", async () => {
    const mermaid = await import("mermaid");
    // Reset the module to force re-initialization
    vi.resetModules();

    // Import fresh module
    const { renderMermaid } = await import("./mermaid");
    await renderMermaid("graph TD; A-->B;");

    // Use "antiscript" (mermaid's default) to allow inline styles from `style` directives
    // while still sanitizing scripts. "strict" would strip all custom styling.
    expect(mermaid.default.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        securityLevel: "antiscript",
      })
    );
  });
});

describe("Security: LaTeX", () => {
  it("should escape HTML entities in error content", async () => {
    const katex = await import("katex");
    // Make katex throw an error
    katex.default.renderToString = vi.fn(() => {
      throw new Error("Parse error");
    });

    vi.resetModules();
    const { renderLatex } = await import("./latex");

    // Test with malicious content
    const maliciousInput = '<script>alert("xss")</script>';
    const result = await renderLatex(maliciousInput);

    // Should NOT contain raw script tag
    expect(result).not.toContain("<script>");
    expect(result).not.toContain("</script>");
    // Should be escaped
    expect(result).toContain("&lt;script&gt;");
  });
});

describe("Security: Image Path Traversal", () => {
  it("should reject paths containing ..", async () => {
    // Import the validation function
    const { validateImagePath } = await import("./imageView/security");

    // These should be rejected
    expect(validateImagePath("../../../etc/passwd")).toBe(false);
    expect(validateImagePath("assets/../../../etc/passwd")).toBe(false);
    expect(validateImagePath("./assets/../../secret.txt")).toBe(false);

    // These should be accepted
    expect(validateImagePath("./assets/images/photo.png")).toBe(true);
    expect(validateImagePath("assets/images/photo.png")).toBe(true);
  });
});

describe("Security: HTML Sanitization", () => {
  it("should export sanitizeHtml function from utils", async () => {
    const { sanitizeHtml } = await import("@/utils/sanitize");
    expect(typeof sanitizeHtml).toBe("function");
  });

  it("should remove script tags from HTML", async () => {
    const { sanitizeHtml } = await import("@/utils/sanitize");

    const maliciousHtml = '<div><script>alert("xss")</script>Hello</div>';
    const result = sanitizeHtml(maliciousHtml);

    expect(result).not.toContain("<script>");
    expect(result).toContain("Hello");
  });

  it("should remove event handlers from HTML", async () => {
    const { sanitizeHtml } = await import("@/utils/sanitize");

    const maliciousHtml = '<img src="x" onerror="alert(1)">';
    const result = sanitizeHtml(maliciousHtml);

    expect(result).not.toContain("onerror");
  });

  it("should hide styles when HTML preview styles are disabled", async () => {
    const { sanitizeHtmlPreview } = await import("@/utils/sanitize");

    const input = '<span style="color: red;">Hello</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: false, context: "inline" });

    expect(result).toContain("Hello");
    expect(result).not.toContain("style=");
  });

  it("should allow whitelisted styles in HTML preview", async () => {
    const { sanitizeHtmlPreview } = await import("@/utils/sanitize");

    const input = '<span style="color: red; position: absolute;">Hello</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true, context: "inline" });

    expect(result).toContain("style=");
    expect(result).toContain("color");
    expect(result).not.toContain("position");
  });

  it("should allow safe SVG elements for mermaid", async () => {
    const { sanitizeSvg } = await import("@/utils/sanitize");

    const safeSvg =
      '<svg><rect x="0" y="0" width="100" height="100"/><text>Hello</text></svg>';
    const result = sanitizeSvg(safeSvg);

    expect(result).toContain("<svg>");
    expect(result).toContain("<rect");
    expect(result).toContain("<text>");
  });
});
