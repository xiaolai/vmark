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

describe("Security: Image Path Classification", () => {
  it("should reject sources that are not resolvable media paths", async () => {
    // Import the validation function
    const { validateImagePath } = await import("./shared/mediaSecurity");

    // A URI scheme is the refusal that carries weight: `file:` addresses the
    // disk and a custom scheme addresses whatever this app registered for it.
    expect(validateImagePath("javascript:alert(1)")).toBe(false);
    expect(validateImagePath("file:///etc/passwd")).toBe(false);
    // Home-relative: no resolver expands `~`, so it would be joined on as a
    // literal segment.
    expect(validateImagePath("~/secrets/key.png")).toBe(false);
    // Names a directory, which nothing can decode.
    expect(validateImagePath("../")).toBe(false);
    expect(validateImagePath("..")).toBe(false);

    // These should be accepted
    expect(validateImagePath("./assets/images/photo.png")).toBe(true);
    expect(validateImagePath("assets/images/photo.png")).toBe(true);
  });

  it("should accept `..` segments — they are path syntax, not an attack (#1433)", async () => {
    const { validateImagePath } = await import("./shared/mediaSecurity");

    // Refusing these blocked the standard shared-assets layout while
    // blocking nothing: an absolute path reaches the same files, is converted
    // one branch earlier with no validation, and the asset scope is `**/*`.
    // See the header of plugins/shared/mediaSecurity.ts.
    expect(validateImagePath("../images/photo.png")).toBe(true);
    expect(validateImagePath("assets/../images/photo.png")).toBe(true);
    expect(validateImagePath("./assets/../../shared/photo.png")).toBe(true);
  });
});

describe("Security: HTML Sanitization", () => {
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
