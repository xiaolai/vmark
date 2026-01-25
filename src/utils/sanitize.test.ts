/**
 * Comprehensive tests for HTML sanitization utilities.
 *
 * Security-critical tests for XSS prevention.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeHtml,
  sanitizeHtmlPreview,
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
  describe("allowed SVG elements", () => {
    it("allows basic SVG structure", () => {
      const input = '<svg><rect x="0" y="0" width="100" height="100"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<svg>");
      expect(result).toContain("<rect");
    });

    it("allows common SVG elements", () => {
      const input = '<svg><circle cx="50" cy="50" r="40"/><path d="M10 10"/><text>Hello</text></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<circle");
      expect(result).toContain("<path");
      expect(result).toContain("<text>");
    });

    it("allows foreignObject for HTML embedding", () => {
      const input = '<svg><foreignObject><div>HTML</div></foreignObject></svg>';
      const result = sanitizeSvg(input);
      expect(result).toContain("<foreignObject>");
    });
  });

  describe("XSS prevention in SVG", () => {
    it("removes script tags from SVG", () => {
      const input = '<svg><script>alert(1)</script></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("<script");
    });

    it("removes onerror handler", () => {
      const input = '<svg><image xlink:href="x" onerror="alert(1)"/></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onerror");
    });

    it("removes onload handler", () => {
      const input = '<svg onload="alert(1)"></svg>';
      const result = sanitizeSvg(input);
      expect(result).not.toContain("onload");
    });

    it("removes onclick handler", () => {
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
