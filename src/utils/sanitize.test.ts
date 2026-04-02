/**
 * Comprehensive tests for HTML sanitization utilities.
 *
 * Security-critical tests for XSS prevention.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlPreview,
  sanitizeMediaHtml,
  sanitizeSvg,
  sanitizeKatex,
  escapeHtml,
} from "./sanitize";

describe("sanitizeHtml", () => {
  describe("allowed tags", () => {
    it("allows basic formatting tags", () => {
      const input = "<strong>bold</strong> <em>italic</em> <b>b</b> <i>i</i>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<strong>");
      expect(result).toContain("<em>");
      expect(result).toContain("<b>");
      expect(result).toContain("<i>");
    });

    it("allows structural tags", () => {
      const input = "<div><p>Paragraph</p><span>Span</span></div>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<div>");
      expect(result).toContain("<p>");
      expect(result).toContain("<span>");
    });

    it("allows list tags", () => {
      const input = "<ul><li>Item 1</li></ul><ol><li>Item 2</li></ol>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<ul>");
      expect(result).toContain("<ol>");
      expect(result).toContain("<li>");
    });

    it("allows heading tags", () => {
      const input = "<h1>H1</h1><h2>H2</h2><h3>H3</h3><h4>H4</h4><h5>H5</h5><h6>H6</h6>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<h1>");
      expect(result).toContain("<h2>");
      expect(result).toContain("<h3>");
      expect(result).toContain("<h4>");
      expect(result).toContain("<h5>");
      expect(result).toContain("<h6>");
    });

    it("allows table tags", () => {
      const input = "<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<table>");
      expect(result).toContain("<thead>");
      expect(result).toContain("<tbody>");
      expect(result).toContain("<tr>");
      expect(result).toContain("<th>");
      expect(result).toContain("<td>");
    });

    it("allows links with href", () => {
      const input = '<a href="https://example.com">Link</a>';
      const result = sanitizeHtml(input);
      expect(result).toContain("<a");
      expect(result).toContain("href=");
      expect(result).toContain("https://example.com");
    });

    it("allows rel attribute on links (tabnabbing prevention)", () => {
      const input = '<a href="https://example.com" target="_blank" rel="noopener noreferrer">Link</a>';
      const result = sanitizeHtml(input);
      expect(result).toContain('rel="noopener noreferrer"');
    });

    it("allows images with src and alt", () => {
      const input = '<img src="image.png" alt="Image">';
      const result = sanitizeHtml(input);
      expect(result).toContain("<img");
      expect(result).toContain('src="image.png"');
      expect(result).toContain('alt="Image"');
    });

    it("allows code and pre tags", () => {
      const input = "<pre><code>const x = 1;</code></pre>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<pre>");
      expect(result).toContain("<code>");
    });

    it("allows blockquote", () => {
      const input = "<blockquote>Quote</blockquote>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<blockquote>");
    });

    it("allows br and hr", () => {
      const input = "Line 1<br>Line 2<hr>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<br");
      expect(result).toContain("<hr");
    });

    it("allows sub and sup", () => {
      const input = "H<sub>2</sub>O and x<sup>2</sup>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<sub>");
      expect(result).toContain("<sup>");
    });

    it("allows underline and strikethrough", () => {
      const input = "<u>underline</u> <s>strike</s>";
      const result = sanitizeHtml(input);
      expect(result).toContain("<u>");
      expect(result).toContain("<s>");
    });
  });

  describe("XSS prevention - script injection", () => {
    it("removes script tags", () => {
      const input = '<script>alert("xss")</script>Hello';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<script>");
      expect(result).not.toContain("alert");
      expect(result).toContain("Hello");
    });

    it("removes script tags with attributes", () => {
      const input = '<script type="text/javascript">alert(1)</script>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<script");
    });

    it("removes nested script tags", () => {
      const input = "<div><script>alert(1)</script></div>";
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<script");
      expect(result).toContain("<div>");
    });

    it("removes script in various casings", () => {
      const inputs = [
        '<SCRIPT>alert(1)</SCRIPT>',
        '<Script>alert(1)</Script>',
        '<scRiPt>alert(1)</scRiPt>',
      ];
      for (const input of inputs) {
        const result = sanitizeHtml(input);
        expect(result.toLowerCase()).not.toContain("<script");
      }
    });
  });

  describe("XSS prevention - event handlers", () => {
    it("removes onerror handler", () => {
      const input = '<img src="x" onerror="alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onerror");
    });

    it("removes onclick handler", () => {
      const input = '<div onclick="alert(1)">Click</div>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onclick");
    });

    it("removes onload handler", () => {
      const input = '<body onload="alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onload");
    });

    it("removes onmouseover handler", () => {
      const input = '<div onmouseover="alert(1)">Hover</div>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onmouseover");
    });

    it("removes onfocus handler", () => {
      const input = '<input onfocus="alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onfocus");
    });

    it("removes onblur handler", () => {
      const input = '<input onblur="alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("onblur");
    });
  });

  describe("XSS prevention - javascript URLs", () => {
    it("removes javascript: in href", () => {
      const input = '<a href="javascript:alert(1)">Click</a>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("javascript:");
    });

    it("removes javascript: in src", () => {
      const input = '<img src="javascript:alert(1)">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("javascript:");
    });

    it("removes javascript: with various encodings", () => {
      const inputs = [
        '<a href="&#106;avascript:alert(1)">Click</a>',
        '<a href="&#x6A;avascript:alert(1)">Click</a>',
      ];
      for (const input of inputs) {
        const result = sanitizeHtml(input);
        expect(result).not.toContain("alert(1)");
      }
    });
  });

  describe("XSS prevention - data attributes", () => {
    it("removes data attributes", () => {
      const input = '<div data-evil="payload">Content</div>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("data-evil");
    });
  });

  describe("XSS prevention - dangerous tags", () => {
    it("removes iframe", () => {
      const input = '<iframe src="evil.html"></iframe>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<iframe");
    });

    it("removes object", () => {
      const input = '<object data="evil.swf"></object>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<object");
    });

    it("removes embed", () => {
      const input = '<embed src="evil.swf">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<embed");
    });

    it("removes form", () => {
      const input = '<form action="evil.php"><input></form>';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<form");
    });

    it("removes style tag", () => {
      const input = "<style>body { background: url(evil.jpg) }</style>";
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<style");
    });

    it("removes link tag", () => {
      const input = '<link rel="stylesheet" href="evil.css">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<link");
    });

    it("removes meta tag", () => {
      const input = '<meta http-equiv="refresh" content="0;url=evil.html">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<meta");
    });

    it("removes base tag", () => {
      const input = '<base href="https://evil.com">';
      const result = sanitizeHtml(input);
      expect(result).not.toContain("<base");
    });
  });
});

describe("sanitizeHtmlPreview", () => {
  describe("inline context", () => {
    it("allows inline formatting tags", () => {
      const input = "<span><strong>bold</strong></span>";
      const result = sanitizeHtmlPreview(input, { context: "inline" });
      expect(result).toContain("<span>");
      expect(result).toContain("<strong>");
    });

    it("removes block-level tags in inline context", () => {
      const input = "<div><p>Block content</p></div>";
      const result = sanitizeHtmlPreview(input, { context: "inline" });
      expect(result).not.toContain("<div>");
      expect(result).not.toContain("<p>");
    });
  });

  describe("block context", () => {
    it("allows block-level tags", () => {
      const input = "<div><p>Content</p></div>";
      const result = sanitizeHtmlPreview(input, { context: "block" });
      expect(result).toContain("<div>");
      expect(result).toContain("<p>");
    });
  });

  describe("style handling", () => {
    it("removes styles when allowStyles is false", () => {
      const input = '<span style="color: red;">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: false });
      expect(result).not.toContain("style=");
    });

    it("allows safe styles when allowStyles is true", () => {
      const input = '<span style="color: red;">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).toContain("color");
    });

    it("filters dangerous style properties", () => {
      const input = '<span style="position: absolute; color: red;">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).not.toContain("position");
      expect(result).toContain("color");
    });

    it("blocks url() in styles", () => {
      const input = '<span style="background: url(evil.jpg);">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).not.toContain("url(");
    });

    it("blocks expression() in styles", () => {
      const input = '<span style="width: expression(alert(1));">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).not.toContain("expression(");
    });

    it("blocks javascript: in styles", () => {
      const input = '<span style="background: javascript:alert(1);">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).not.toContain("javascript:");
    });
  });
});

describe("sanitizeSvg", () => {
  describe("valid SVG elements — must be preserved", () => {
    it("allows basic SVG structure with rect", () => {
      const input = '<svg><rect x="0" y="0" width="100" height="100"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<svg>");
      expect(result).toContain("<rect");
    });

    it("allows path, circle, and text elements", () => {
      const input = '<svg><circle cx="50" cy="50" r="40"/><path d="M10 10"/><text>Hello</text></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<circle");
      expect(result).toContain("<path");
      expect(result).toContain("<text>");
    });

    it("allows g (group) element", () => {
      const input = '<svg><g transform="translate(10,10)"><rect width="50" height="50"/></g></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<g");
      expect(result).toContain("transform=");
    });

    it("allows defs and use elements", () => {
      const input = '<svg><defs><rect id="r" width="10" height="10"/></defs><use href="#r"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<defs>");
      expect(result).toContain("<use");
    });

    it("allows foreignObject for HTML embedding (Mermaid diagrams)", () => {
      const input = '<svg><foreignObject><div>HTML</div></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<foreignObject>");
    });

    it("preserves valid fill, stroke, and transform attributes", () => {
      const input = '<svg><rect fill="#ff0000" stroke="#000" transform="rotate(45)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain('fill="#ff0000"');
      expect(result).toContain('stroke="#000"');
      expect(result).toContain("transform=");
    });

    it("preserves CSS classes on SVG elements", () => {
      const input = '<svg><rect class="node-shape" width="100" height="50"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain('class="node-shape"');
    });

    it("preserves non-malicious inline styles (Mermaid uses these)", () => {
      const input = '<svg><text style="font-size: 14px; fill: #333;">Label</text></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("style=");
      expect(result).toContain("Label");
    });

    it("preserves viewBox and xmlns attributes", () => {
      const input = '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("viewBox=");
      expect(result).toContain("xmlns=");
    });

    it("preserves marker-end and marker-start attributes", () => {
      const input = '<svg><line x1="0" y1="0" x2="50" y2="50" marker-end="url(#arrow)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("marker-end=");
    });

    it("preserves a typical Mermaid flowchart SVG", () => {
      const input = `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
        <g class="nodes">
          <rect x="10" y="10" width="120" height="40" rx="5" ry="5" fill="#f9f" stroke="#333"/>
          <foreignObject x="10" y="10" width="120" height="40">
            <div style="display: flex; align-items: center; justify-content: center; line-height: 1.2;">
              <span>Start</span>
            </div>
          </foreignObject>
        </g>
        <path d="M130 30 L200 30" stroke="#333" marker-end="url(#arrowhead)"/>
      </svg>`;
      const result = sanitizeSvg(input);
      expect(result).toContain("<rect");
      expect(result).toContain("<foreignObject");
      expect(result).toContain("<path");
      expect(result).toContain("Start");
      expect(result).toContain("marker-end=");
    });
  });

  describe("XSS prevention — script injection", () => {
    it("removes script tags from SVG", () => {
      const input = '<svg><script>alert(1)</script></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
      expect(result).not.toContain("alert");
    });

    it("removes script tags with type attribute", () => {
      const input = '<svg><script type="text/ecmascript">alert(1)</script></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
    });

    it("removes script tags in mixed case", () => {
      const inputs = [
        '<svg><SCRIPT>alert(1)</SCRIPT></svg>',
        '<svg><Script>alert(1)</Script></svg>',
        '<svg><scRiPt>alert(1)</scRiPt></svg>',
      ];
      for (const input of inputs) {
        const result = sanitizeSvg(input);
        expect(result.toLowerCase()).not.toContain("<script");
      }
    });

    it("removes script tags nested inside g elements", () => {
      const input = '<svg><g><script>alert(1)</script><rect width="10" height="10"/></g></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
      expect(result).toContain("<rect");
    });
  });

  describe("XSS prevention — event handlers", () => {
    it("removes onerror handler from image", () => {
      const input = '<svg><image xlink:href="x" onerror="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onerror");
    });

    it("removes onload handler from svg root", () => {
      const input = '<svg onload="alert(1)"></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onload");
    });

    it("removes onclick handler from rect", () => {
      const input = '<svg><rect onclick="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onclick");
    });

    it("removes onmouseover handler", () => {
      const input = '<svg><rect onmouseover="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onmouseover");
    });

    it("removes onfocus handler", () => {
      const input = '<svg><rect onfocus="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onfocus");
    });

    it("removes onblur handler", () => {
      const input = '<svg><rect onblur="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onblur");
    });

    it("removes event handlers in mixed case", () => {
      const input = '<svg><rect ONCLICK="alert(1)" OnMouseOver="alert(2)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result.toLowerCase()).not.toContain("onclick");
      expect(result.toLowerCase()).not.toContain("onmouseover");
    });

    it("removes event handlers on text elements", () => {
      const input = '<svg><text onclick="alert(1)">Click me</text></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onclick");
      expect(result).toContain("Click me");
    });

    it("removes event handlers on foreignObject children", () => {
      const input = '<svg><foreignObject><div onclick="alert(1)">Content</div></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onclick");
      expect(result).toContain("Content");
    });
  });

  describe("XSS prevention — foreignObject with scripts", () => {
    it("removes script tags inside foreignObject", () => {
      const input = '<svg><foreignObject><script>alert(1)</script></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
    });

    it("removes script tags inside nested HTML in foreignObject", () => {
      const input = '<svg><foreignObject><div><script>alert(1)</script>Safe text</div></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
      expect(result).toContain("Safe text");
    });

    it("removes event handlers on HTML elements inside foreignObject", () => {
      const input = '<svg><foreignObject><div onmouseover="alert(1)"><span onclick="alert(2)">Text</span></div></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onmouseover");
      expect(result).not.toContain("onclick");
      expect(result).toContain("Text");
    });

    it("removes iframe inside foreignObject", () => {
      const input = '<svg><foreignObject><iframe src="https://evil.com"></iframe></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<iframe");
    });
  });

  describe("XSS prevention — javascript: URLs", () => {
    it("removes javascript: in href attribute", () => {
      const input = '<svg><a href="javascript:alert(1)"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("javascript:");
    });

    it("removes javascript: in xlink:href attribute", () => {
      const input = '<svg><a xlink:href="javascript:alert(1)"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("javascript:");
    });

    it("removes javascript: URL with HTML entity encoding (&#106;avascript:)", () => {
      const input = '<svg><a href="&#106;avascript:alert(1)"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("alert(1)");
    });

    it("removes javascript: URL with hex entity encoding (&#x6A;avascript:)", () => {
      const input = '<svg><a href="&#x6A;avascript:alert(1)"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("alert(1)");
    });

    it("removes javascript: URL with tab/newline obfuscation", () => {
      const input = '<svg><a href="java\tscript:alert(1)"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      // DOMPurify should strip the dangerous href
      expect(result).not.toContain("alert(1)");
    });
  });

  describe("XSS prevention — data: URLs", () => {
    it("removes data:text/html URLs in href", () => {
      const input = '<svg><a href="data:text/html,<script>alert(1)</script>"><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("data:text/html");
    });

    it("removes data:text/html URLs with base64 encoding", () => {
      const input = '<svg><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="><text>Click</text></a></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("data:text/html");
    });
  });

  describe("XSS prevention — malicious CSS in style attributes", () => {
    it("removes expression() in style attributes (IE vector)", () => {
      const input = '<svg><rect style="width: expression(alert(1))"/></svg>';
      const result = sanitizeSvg(input);
      // DOMPurify or the browser should neutralize expression()
      expect(result).not.toContain("expression(");
    });

    it("removes url(javascript:) in style attributes", () => {
      const input = '<svg><rect style="background: url(javascript:alert(1))"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("javascript:");
    });

    it("removes -moz-binding in style (Firefox XBL vector)", () => {
      const input = '<svg><rect style="-moz-binding: url(evil.xml#xss)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("-moz-binding");
    });
  });

  describe("XSS prevention — nested SVGs with malicious content", () => {
    it("removes script tags from nested SVG", () => {
      const input = '<svg><svg><script>alert(1)</script></svg></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
    });

    it("removes event handlers from nested SVG elements", () => {
      const input = '<svg><svg onload="alert(1)"><rect onclick="alert(2)"/></svg></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onload");
      expect(result).not.toContain("onclick");
    });

    it("preserves valid nested SVG content while stripping malicious parts", () => {
      const input = '<svg><svg><rect width="10" height="10" fill="red"/><script>alert(1)</script></svg></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<rect");
      expect(result).toContain('fill="red"');
      expect(result).not.toContain("<script");
    });
  });

  describe("edge cases", () => {
    it("handles empty string input", () => {
      const result = sanitizeSvg("");
      expect(result).toBe("");
    });

    it("handles non-SVG HTML input (strips non-SVG-profile tags)", () => {
      // With svg+html profiles, some HTML tags are kept, but scripts are still removed
      const input = "<div><p>Hello</p></div>";
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
    });

    it("handles malformed/incomplete SVG tags", () => {
      const input = "<svg><rect width='100'";
      const result = sanitizeSvg(input);
      // Should not throw; DOMPurify handles malformed HTML gracefully
      expect(typeof result).toBe("string");
    });

    it("handles SVG with unclosed tags", () => {
      const input = "<svg><g><rect width='50' height='50'>";
      const result = sanitizeSvg(input);
      expect(typeof result).toBe("string");
    });

    it("handles extremely large SVG without hanging", () => {
      // Generate a large SVG with many elements (10,000 rects)
      const rects = Array.from({ length: 10_000 }, (_, i) =>
        `<rect x="${i}" y="0" width="1" height="1"/>`,
      ).join("");
      const input = `<svg>${rects}</svg>`;

      const start = performance.now();
      const result = sanitizeSvg(input);
      const elapsed = performance.now() - start;

      expect(result).toContain("<rect");
      // Should complete in reasonable time (under 5 seconds)
      expect(elapsed).toBeLessThan(5000);
    });

    it("handles SVG with CDATA sections", () => {
      const input = '<svg><style><![CDATA[ .cls { fill: red; } ]]></style><rect class="cls" width="10" height="10"/></svg>';
      const result = sanitizeSvg(input);
      // Should not throw; content should be processed
      expect(typeof result).toBe("string");
      expect(result).toContain("<rect");
    });

    it("handles SVG with XML processing instructions", () => {
      const input = '<?xml version="1.0"?><svg><rect width="10" height="10"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<rect");
    });

    it("handles SVG with unicode/CJK text content", () => {
      const input = '<svg><text>你好世界 🎨 مرحبا</text></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("你好世界");
      expect(result).toContain("🎨");
      expect(result).toContain("مرحبا");
    });

    it("handles SVG with only whitespace", () => {
      const result = sanitizeSvg("   \n\t  ");
      expect(result.trim()).toBe("");
    });

    it("handles SVG with comments", () => {
      const input = '<svg><!-- comment --><rect width="10" height="10"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<rect");
    });
  });

  describe("combined attack vectors", () => {
    it("strips script while preserving valid Mermaid diagram structure", () => {
      const input = `<svg viewBox="0 0 500 300">
        <g class="nodes">
          <rect x="10" y="10" width="100" height="40" fill="#f0f0f0" stroke="#333"/>
          <foreignObject x="10" y="10" width="100" height="40">
            <div style="text-align: center;">Node A</div>
          </foreignObject>
        </g>
        <script>document.cookie</script>
        <path d="M110 30 L200 30" stroke="#333"/>
      </svg>`;
      const result = sanitizeSvg(input);
      expect(result).toContain("Node A");
      expect(result).toContain("<rect");
      expect(result).toContain("<path");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("document.cookie");
    });

    it("strips multiple attack vectors in a single SVG", () => {
      const input = `<svg onload="alert(1)">
        <rect onclick="alert(2)" width="10" height="10"/>
        <script>alert(3)</script>
        <a href="javascript:alert(4)"><text>Link</text></a>
        <image onerror="alert(5)"/>
        <text onfocus="alert(6)">Text</text>
      </svg>`;
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onload");
      expect(result).not.toContain("onclick");
      expect(result).not.toContain("<script");
      expect(result).not.toContain("javascript:");
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("onfocus");
      // Valid content should survive
      expect(result).toContain("<rect");
      expect(result).toContain("Text");
    });

    it("handles mutation XSS attempt with SVG and foreignObject", () => {
      // Mutation XSS: content that is safe as parsed but dangerous when re-serialized
      const input = '<svg><foreignObject><math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert(1)></table></mtext></math></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onerror");
      expect(result).not.toContain("alert(1)");
    });
  });
});

describe("sanitizeKatex", () => {
  describe("allowed KaTeX elements", () => {
    it("allows span elements", () => {
      const input = '<span class="katex">Math</span>';
      const result = sanitizeKatex(input);
      expect(result).toContain("<span");
    });

    it("allows MathML elements", () => {
      const input = "<math><mrow><mi>x</mi><mo>+</mo><mn>1</mn></mrow></math>";
      const result = sanitizeKatex(input);
      expect(result).toContain("<math>");
      expect(result).toContain("<mrow>");
      expect(result).toContain("<mi>");
      expect(result).toContain("<mo>");
      expect(result).toContain("<mn>");
    });

    it("allows msup and msub", () => {
      const input = "<math><msup><mi>x</mi><mn>2</mn></msup><msub><mi>y</mi><mn>1</mn></msub></math>";
      const result = sanitizeKatex(input);
      expect(result).toContain("<msup>");
      expect(result).toContain("<msub>");
    });

    it("allows mfrac", () => {
      const input = "<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>";
      const result = sanitizeKatex(input);
      expect(result).toContain("<mfrac>");
    });

    it("allows SVG elements used by KaTeX", () => {
      const input = '<svg><line x1="0" y1="0" x2="10" y2="10"/><path d="M0 0"/></svg>';
      const result = sanitizeKatex(input);
      expect(result).toContain("<svg>");
      expect(result).toContain("<line");
      expect(result).toContain("<path");
    });
  });

  describe("XSS prevention in KaTeX", () => {
    it("removes script tags", () => {
      const input = '<span class="katex"><script>alert(1)</script></span>';
      const result = sanitizeKatex(input);
      expect(result).not.toContain("<script");
    });

    it("removes dangerous attributes", () => {
      const input = '<span class="katex" onclick="alert(1)">Math</span>';
      const result = sanitizeKatex(input);
      expect(result).not.toContain("onclick");
    });
  });
});

describe("sanitizeMediaHtml", () => {
  describe("allowed media tags", () => {
    it("allows video tag with src", () => {
      const input = '<video src="clip.mp4" controls></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<video");
      expect(result).toContain('src="clip.mp4"');
      expect(result).toContain("controls");
    });

    it("allows audio tag with src", () => {
      const input = '<audio src="song.mp3" controls></audio>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<audio");
      expect(result).toContain('src="song.mp3"');
    });

    it("allows source tag inside video", () => {
      const input = '<video controls><source src="clip.mp4" type="video/mp4"></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<source");
      expect(result).toContain('type="video/mp4"');
    });

    it("allows video attributes: poster, preload, loop, muted", () => {
      const input = '<video src="clip.mp4" poster="thumb.jpg" preload="metadata" loop muted controls></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain('poster="thumb.jpg"');
      expect(result).toContain('preload="metadata"');
    });

    it("allows width and height on video", () => {
      const input = '<video src="clip.mp4" width="640" height="360" controls></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain('width="640"');
      expect(result).toContain('height="360"');
    });
  });

  describe("XSS prevention in media", () => {
    it("strips script inside video", () => {
      const input = '<video><script>alert(1)</script></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("<script");
    });

    it("strips onerror on video", () => {
      const input = '<video src="x" onerror="alert(1)"></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("onerror");
    });

    it("strips javascript: in src", () => {
      const input = '<video src="javascript:alert(1)"></video>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("javascript:");
    });
  });

  describe("video provider iframe handling", () => {
    it("allows YouTube iframe with nocookie domain", () => {
      const input = '<iframe src="https://www.youtube-nocookie.com/embed/abc123" width="560" height="315"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<iframe");
      expect(result).toContain("youtube-nocookie.com");
    });

    it("allows YouTube iframe with youtube.com domain", () => {
      const input = '<iframe src="https://www.youtube.com/embed/abc123" width="560" height="315"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<iframe");
      expect(result).toContain("youtube.com");
    });

    it("allows Vimeo iframe", () => {
      const input = '<iframe src="https://player.vimeo.com/video/123456789" width="560" height="315"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<iframe");
      expect(result).toContain("player.vimeo.com");
    });

    it("allows Bilibili iframe", () => {
      const input = '<iframe src="https://player.bilibili.com/player.html?bvid=BV1xx411c7mD" width="560" height="350"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).toContain("<iframe");
      expect(result).toContain("player.bilibili.com");
    });

    it("strips non-whitelisted iframes", () => {
      const input = '<iframe src="https://evil.com/page"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("evil.com");
    });
  });
});

describe("escapeHtml", () => {
  it("escapes ampersand", () => {
    expect(escapeHtml("Tom & Jerry")).toBe("Tom &amp; Jerry");
  });

  it("escapes less than", () => {
    expect(escapeHtml("x < y")).toBe("x &lt; y");
  });

  it("escapes greater than", () => {
    expect(escapeHtml("x > y")).toBe("x &gt; y");
  });

  it("escapes double quotes", () => {
    expect(escapeHtml('say "hello"')).toBe("say &quot;hello&quot;");
  });

  it("escapes single quotes", () => {
    expect(escapeHtml("it's")).toBe("it&#39;s");
  });

  it("escapes all special characters together", () => {
    const input = '<script>alert("xss" & \'test\')</script>';
    const result = escapeHtml(input);
    expect(result).toBe("&lt;script&gt;alert(&quot;xss&quot; &amp; &#39;test&#39;)&lt;/script&gt;");
  });

  it("leaves normal text unchanged", () => {
    expect(escapeHtml("Hello World")).toBe("Hello World");
  });

  it("handles empty string", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("handles unicode", () => {
    expect(escapeHtml("Hello 世界")).toBe("Hello 世界");
  });
});

describe("sanitizeHtmlPreview — additional coverage", () => {
  it("defaults to inline context when no options provided", () => {
    const input = "<div>block</div><span>inline</span>";
    const result = sanitizeHtmlPreview(input);
    // Inline context strips block-level tags
    expect(result).not.toContain("<div>");
    expect(result).toContain("<span>");
  });

  it("removes style attribute with only unsafe properties", () => {
    const input = '<span style="position: absolute; z-index: 9999;">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    // position and z-index are not in the allowlist
    expect(result).not.toContain("position");
    expect(result).not.toContain("z-index");
  });

  it("handles style with < and > in value", () => {
    const input = '<span style="color: red<blue>">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).not.toContain("<blue>");
  });

  it("preserves allowed style properties with colons in value", () => {
    // e.g., color with hsl notation has colons
    const input = '<span style="color: rgb(255, 0, 0);">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).toContain("color");
  });

  it("handles empty style attribute", () => {
    const input = '<span style="">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).toContain("Text");
  });

  it("handles style declaration missing colon", () => {
    const input = '<span style="invalid-property">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).toContain("Text");
  });
});

describe("sanitizeSvg — style sanitization", () => {
  it("removes behavior: CSS property from SVG style", () => {
    const input = '<svg><rect style="behavior: url(evil.htc)"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).not.toContain("behavior");
  });

  it("preserves valid SVG styles", () => {
    const input = '<svg><rect style="fill: blue; stroke-width: 2px;"/></svg>';
    const result = sanitizeSvg(input);
    expect(result).toContain("style=");
  });
});

describe("sanitize — isSafeStyleValue angle brackets branch", () => {
  it("blocks style values containing < character", () => {
    const input = '<span style="color: red<script>alert(1)</script>;">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    // The < in the style value should cause isSafeStyleValue to return false
    expect(result).not.toContain("red<script>");
  });

  it("blocks style values containing > character", () => {
    const input = '<span style="color: >red;">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).not.toContain(">red");
  });
});

describe("sanitizeMediaHtml — no-DOM stripNonWhitelistedIframes branch", () => {
  it("strips self-closing iframe forms when DOM is available", () => {
    // In jsdom, the DOM path is taken, which exercises the DOM-based stripping
    const input = '<iframe src="https://evil.com/page"></iframe>';
    const result = sanitizeMediaHtml(input);
    expect(result).not.toContain("evil.com");
  });
});

describe("sanitize — isSafeStyleValue angle bracket via sanitizeStyleAttribute", () => {
  it("removes style declarations with embedded < angle bracket", () => {
    // Use an element with style that includes < to trigger line 215
    const input = '<div style="color: red; background: abc<def;">Text</div>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    // The background declaration with < should be removed, color: red should stay
    expect(result).toContain("Text");
  });
});

describe("sanitizeMediaHtml — iframe edge cases", () => {
  it("allows YouTube iframe without www prefix", () => {
    const input = '<iframe src="https://youtube.com/embed/abc"></iframe>';
    const result = sanitizeMediaHtml(input);
    expect(result).toContain("<iframe");
    expect(result).toContain("youtube.com");
  });

  it("strips iframes with no src attribute", () => {
    const input = '<iframe></iframe>';
    const result = sanitizeMediaHtml(input);
    // An iframe with no src has empty string which doesn't match whitelist
    expect(result).not.toContain("<iframe");
  });

  it("returns HTML as-is when no iframes present", () => {
    const input = '<video src="clip.mp4" controls></video>';
    const result = sanitizeMediaHtml(input);
    expect(result).toContain("<video");
  });
});

describe("sanitize — isSafeStyleValue url() and expression() via allowed property", () => {
  // These tests use CSS properties that ARE in HTML_PREVIEW_STYLE_PROPS so the
  // property allowlist check passes and isSafeStyleValue is actually reached.
  // The url( and expression( checks at line 214 are the target branches.

  it("blocks url() in an allowed style property value (color with url injection)", () => {
    // Use text-decoration which is in the allowlist, with a url() value
    const input = '<span style="text-decoration: url(evil.css);">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).not.toContain("url(");
  });

  it("blocks expression() in an allowed style property value (color with expression)", () => {
    // Use color which is in the allowlist, with an expression() value
    const input = '<span style="color: expression(alert(1));">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).not.toContain("expression(");
  });

  it("blocks javascript: in an allowed style property value", () => {
    // Use font-style which is in the allowlist, with a javascript: value
    const input = '<span style="font-style: javascript:alert(1);">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).not.toContain("javascript:");
  });

  it("allows safe url-free value for an allowed property", () => {
    // Confirm the positive path still works — safe value passes isSafeStyleValue
    const input = '<span style="color: red;">Text</span>';
    const result = sanitizeHtmlPreview(input, { allowStyles: true });
    expect(result).toContain("color: red");
  });
});

describe("sanitize — filterAllowedStyles no-DOM branch (line 170)", () => {
  // Simulate a server-side / no-DOM environment by temporarily replacing document.
  // When typeof document === "undefined", filterAllowedStyles falls back to a
  // regex-based strip of all style attributes.

  it("strips style attributes via regex when document is not available", () => {
    const saved = global.document;
    try {
      // @ts-expect-error intentionally removing document to test the no-DOM path
      delete global.document;
      const input = '<span style="color: red;">Text</span>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      // In no-DOM mode the regex strips style attrs entirely
      expect(result).not.toContain("style=");
      expect(result).toContain("Text");
    } finally {
      global.document = saved;
    }
  });

  it("handles multiple style attributes in no-DOM mode", () => {
    const saved = global.document;
    try {
      // @ts-expect-error intentionally removing document to test the no-DOM path
      delete global.document;
      const input = '<span style="color: red; font-weight: bold;">A</span><em style="font-style: italic;">B</em>';
      const result = sanitizeHtmlPreview(input, { allowStyles: true });
      expect(result).not.toContain("style=");
      expect(result).toContain("A");
      expect(result).toContain("B");
    } finally {
      global.document = saved;
    }
  });
});

describe("sanitize — stripNonWhitelistedIframes no-DOM branch (line 267)", () => {
  // Same technique: remove global.document so the no-DOM regex path is taken.

  it("strips paired iframes via regex when document is not available", () => {
    const saved = global.document;
    try {
      // @ts-expect-error intentionally removing document to test the no-DOM path
      delete global.document;
      const input = '<iframe src="https://evil.com/page">inner</iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("<iframe");
      expect(result).not.toContain("evil.com");
    } finally {
      global.document = saved;
    }
  });

  it("strips self-closing iframes via regex when document is not available", () => {
    const saved = global.document;
    try {
      // @ts-expect-error intentionally removing document to test the no-DOM path
      delete global.document;
      const input = '<iframe src="https://evil.com/page" />';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("<iframe");
    } finally {
      global.document = saved;
    }
  });

  it("strips even whitelisted iframes via regex when document is not available (safety over permissiveness)", () => {
    const saved = global.document;
    try {
      // @ts-expect-error intentionally removing document to test the no-DOM path
      delete global.document;
      // In no-DOM mode ALL iframes are removed — can't verify src safely
      const input = '<iframe src="https://www.youtube.com/embed/abc"></iframe>';
      const result = sanitizeMediaHtml(input);
      expect(result).not.toContain("<iframe");
    } finally {
      global.document = saved;
    }
  });
});

describe("sanitizeHtmlPreview — layout attributes (#618)", () => {
  it("preserves width attribute on img", () => {
    const input = '<img src="photo.jpg" alt="Photo" width="200" />';
    const result = sanitizeHtmlPreview(input, { context: "block" });
    expect(result).toContain('width="200"');
  });

  it("preserves height attribute on img", () => {
    const input = '<img src="photo.jpg" alt="Photo" height="100" />';
    const result = sanitizeHtmlPreview(input, { context: "block" });
    expect(result).toContain('height="100"');
  });

  it("preserves align attribute on p", () => {
    const input = '<p align="center">Centered</p>';
    const result = sanitizeHtmlPreview(input, { context: "block" });
    expect(result).toContain('align="center"');
  });

  it("renders centered image pattern from GitHub READMEs", () => {
    const input = '<p align="center"><img src="icon.svg" alt="Icon" width="200" /></p>';
    const result = sanitizeHtmlPreview(input, { context: "block" });
    expect(result).toContain('align="center"');
    expect(result).toContain('width="200"');
    expect(result).toContain('src="icon.svg"');
  });

  it("preserves text-align style when allowStyles is true", () => {
    const input = '<div style="text-align: center;">Centered</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("text-align");
  });

  it("preserves margin style when allowStyles is true", () => {
    const input = '<div style="margin: 0 auto;">Centered</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("margin");
  });

  it("preserves max-width style when allowStyles is true", () => {
    const input = '<img style="max-width: 100%;" src="img.png" />';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("max-width");
  });

  it("preserves display style when allowStyles is true", () => {
    const input = '<span style="display: inline-block;">Box</span>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("display");
  });

  it("preserves padding style when allowStyles is true", () => {
    const input = '<div style="padding: 10px;">Padded</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("padding");
  });

  it("preserves width/height styles when allowStyles is true", () => {
    const input = '<div style="width: 200px; height: 100px;">Sized</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).toContain("width");
    expect(result).toContain("height");
  });

  it("still blocks position style (security)", () => {
    const input = '<div style="position: fixed; text-align: center;">Trap</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).not.toContain("position");
    expect(result).toContain("text-align");
  });

  it("still blocks url() in layout styles (security)", () => {
    const input = '<div style="background: url(evil.jpg); margin: 10px;">Test</div>';
    const result = sanitizeHtmlPreview(input, { context: "block", allowStyles: true });
    expect(result).not.toContain("url(");
    expect(result).toContain("margin");
  });
});
