/**
 * Tests for markdown URL encoding/decoding utilities
 */

import { describe, it, expect } from "vitest";
import { encodeMarkdownUrl, decodeMarkdownUrl, urlNeedsBrackets } from "./markdownUrl";

describe("urlNeedsBrackets", () => {
  it("returns true for URLs with regular spaces", () => {
    expect(urlNeedsBrackets("/path/with spaces.png")).toBe(true);
  });

  it("returns true for URLs with non-breaking space", () => {
    expect(urlNeedsBrackets("/path/with\u00A0nbsp.png")).toBe(true);
  });

  it("returns false for URLs without spaces", () => {
    expect(urlNeedsBrackets("/path/no-spaces.png")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(urlNeedsBrackets("")).toBe(false);
  });
});

describe("encodeMarkdownUrl", () => {
  it("wraps URLs with spaces in angle brackets", () => {
    expect(encodeMarkdownUrl("/path/with spaces.png")).toBe("</path/with spaces.png>");
  });

  it("wraps URLs with multiple spaces", () => {
    expect(encodeMarkdownUrl("/path/with  multiple   spaces.png")).toBe(
      "</path/with  multiple   spaces.png>"
    );
  });

  it("wraps URLs with non-breaking space (U+00A0)", () => {
    expect(encodeMarkdownUrl("/path/with\u00A0nbsp.png")).toBe("</path/with\u00A0nbsp.png>");
  });

  it("wraps URLs with en space (U+2002)", () => {
    expect(encodeMarkdownUrl("/path/with\u2002enspace.png")).toBe("</path/with\u2002enspace.png>");
  });

  it("wraps URLs with em space (U+2003)", () => {
    expect(encodeMarkdownUrl("/path/with\u2003emspace.png")).toBe("</path/with\u2003emspace.png>");
  });

  it("does not wrap paths without spaces", () => {
    expect(encodeMarkdownUrl("/path/no-spaces.png")).toBe("/path/no-spaces.png");
  });

  it("handles empty string", () => {
    expect(encodeMarkdownUrl("")).toBe("");
  });

  it("handles null-ish values", () => {
    expect(encodeMarkdownUrl(null as unknown as string)).toBe(null);
    expect(encodeMarkdownUrl(undefined as unknown as string)).toBe(undefined);
  });
});

describe("decodeMarkdownUrl", () => {
  it("strips angle brackets from URL", () => {
    expect(decodeMarkdownUrl("</path/with spaces.png>")).toBe("/path/with spaces.png");
  });

  it("decodes %20 to space (backward compatibility)", () => {
    expect(decodeMarkdownUrl("/path/with%20spaces.png")).toBe("/path/with spaces.png");
  });

  it("decodes multiple %20", () => {
    expect(decodeMarkdownUrl("/path/with%20%20multiple%20spaces.png")).toBe(
      "/path/with  multiple spaces.png"
    );
  });

  it("handles paths without encoding", () => {
    expect(decodeMarkdownUrl("/path/no-encoding.png")).toBe("/path/no-encoding.png");
  });

  it("handles empty string", () => {
    expect(decodeMarkdownUrl("")).toBe("");
  });

  it("handles malformed percent encoding gracefully", () => {
    // Should return as-is if decoding fails
    expect(decodeMarkdownUrl("/path/with%ZZbad.png")).toBe("/path/with%ZZbad.png");
  });

  it("decodes other percent-encoded characters", () => {
    expect(decodeMarkdownUrl("/path/%28parens%29.png")).toBe("/path/(parens).png");
  });

  it("decodes non-breaking space encoding (backward compatibility)", () => {
    // %C2%A0 is the UTF-8 encoding of U+00A0
    expect(decodeMarkdownUrl("/path/with%C2%A0nbsp.png")).toBe("/path/with\u00A0nbsp.png");
  });
});

describe("round-trip", () => {
  it("encode then decode returns original with spaces", () => {
    const original = "/Users/test/My Screenshots/Screenshot 2026-01-19.png";
    const encoded = encodeMarkdownUrl(original);
    expect(encoded).toBe("</Users/test/My Screenshots/Screenshot 2026-01-19.png>");
    const decoded = decodeMarkdownUrl(encoded);
    expect(decoded).toBe(original);
  });

  it("preserves non-breaking space through round-trip", () => {
    const original = "/Users/test/Screenshot\u00A02026.png";
    const encoded = encodeMarkdownUrl(original);
    expect(encoded).toBe("</Users/test/Screenshot\u00A02026.png>");
    const decoded = decodeMarkdownUrl(encoded);
    expect(decoded).toBe(original);
  });

  it("preserves mixed whitespace types through round-trip", () => {
    const original = "/path/regular space\u00A0nbsp.png";
    const encoded = encodeMarkdownUrl(original);
    const decoded = decodeMarkdownUrl(encoded);
    expect(decoded).toBe(original);
  });

  it("no-op for paths without spaces", () => {
    const original = "/path/no-spaces.png";
    const encoded = encodeMarkdownUrl(original);
    expect(encoded).toBe(original); // No brackets added
    const decoded = decodeMarkdownUrl(encoded);
    expect(decoded).toBe(original);
  });
});
