/**
 * URL Detection Utility Tests
 */

import { describe, it, expect } from "vitest";
import { detectAndNormalizeUrl } from "./urlDetection";

describe("detectAndNormalizeUrl", () => {
  describe("standard protocols", () => {
    it("detects http:// URLs", () => {
      const result = detectAndNormalizeUrl("http://example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://example.com");
    });

    it("detects https:// URLs", () => {
      const result = detectAndNormalizeUrl("https://example.com/path?query=1");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com/path?query=1");
    });

    it("detects mailto: URLs", () => {
      const result = detectAndNormalizeUrl("mailto:user@example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("mailto:user@example.com");
    });

    it("detects tel: URLs", () => {
      const result = detectAndNormalizeUrl("tel:+1234567890");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("tel:+1234567890");
    });

    it("detects ftp:// URLs", () => {
      const result = detectAndNormalizeUrl("ftp://files.example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("ftp://files.example.com");
    });

    it("detects sftp:// URLs", () => {
      const result = detectAndNormalizeUrl("sftp://server.example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("sftp://server.example.com");
    });

    it("detects file:// URLs", () => {
      const result = detectAndNormalizeUrl("file:///Users/test/document.md");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("file:///Users/test/document.md");
    });
  });

  describe("custom protocols", () => {
    it("detects obsidian:// with custom protocols", () => {
      const result = detectAndNormalizeUrl(
        "obsidian://open?vault=my-vault",
        ["obsidian", "vscode"]
      );
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("obsidian://open?vault=my-vault");
    });

    it("detects vscode:// with custom protocols", () => {
      const result = detectAndNormalizeUrl(
        "vscode://file/path/to/file",
        ["obsidian", "vscode"]
      );
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("vscode://file/path/to/file");
    });

    it("detects dict:// with custom protocols", () => {
      const result = detectAndNormalizeUrl(
        "dict://word",
        ["dict", "x-dictionary"]
      );
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("dict://word");
    });

    it("ignores unknown protocols without custom list", () => {
      const result = detectAndNormalizeUrl("obsidian://open?vault=test");
      expect(result.isUrl).toBe(false);
      expect(result.normalizedUrl).toBeNull();
    });

    it("rejects javascript: even if passed as custom protocol (XSS prevention)", () => {
      const result = detectAndNormalizeUrl("javascript:alert(1)", ["javascript"]);
      expect(result.isUrl).toBe(false);
    });

    it("rejects vbscript: even if passed as custom protocol", () => {
      const result = detectAndNormalizeUrl("vbscript:MsgBox", ["vbscript"]);
      expect(result.isUrl).toBe(false);
    });

    it("rejects data: even if passed as custom protocol", () => {
      const result = detectAndNormalizeUrl("data:text/html,<h1>hi</h1>", ["data"]);
      expect(result.isUrl).toBe(false);
    });
  });

  describe("bare email addresses", () => {
    it("detects and normalizes bare email", () => {
      const result = detectAndNormalizeUrl("user@example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("mailto:user@example.com");
    });

    it("handles complex email addresses", () => {
      const result = detectAndNormalizeUrl("user.name+tag@sub.domain.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("mailto:user.name+tag@sub.domain.com");
    });

    it("rejects invalid email patterns", () => {
      expect(detectAndNormalizeUrl("not-an-email").isUrl).toBe(false);
      expect(detectAndNormalizeUrl("@example.com").isUrl).toBe(false);
      expect(detectAndNormalizeUrl("user@").isUrl).toBe(false);
    });
  });

  describe("bare domains", () => {
    it("detects domain with path", () => {
      const result = detectAndNormalizeUrl("example.com/page");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com/page");
    });

    it("detects domain with complex path", () => {
      const result = detectAndNormalizeUrl("github.com/user/repo/blob/main/file.ts");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://github.com/user/repo/blob/main/file.ts");
    });

    it("detects domain with common TLD (no path)", () => {
      const result = detectAndNormalizeUrl("example.com");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com");
    });

    it("detects domain with .io TLD", () => {
      const result = detectAndNormalizeUrl("api.example.io");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://api.example.io");
    });

    it("rejects unknown TLD without path", () => {
      const result = detectAndNormalizeUrl("example.unknowntld");
      expect(result.isUrl).toBe(false);
    });

    it("accepts subdomain with path", () => {
      const result = detectAndNormalizeUrl("sub.example.unknowntld/path");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://sub.example.unknowntld/path");
    });
  });

  describe("localhost and IP addresses", () => {
    it("detects localhost", () => {
      const result = detectAndNormalizeUrl("localhost");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://localhost");
    });

    it("detects localhost with port", () => {
      const result = detectAndNormalizeUrl("localhost:3000");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://localhost:3000");
    });

    it("detects localhost with path", () => {
      const result = detectAndNormalizeUrl("localhost:8080/api/users");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://localhost:8080/api/users");
    });

    it("detects IP address", () => {
      const result = detectAndNormalizeUrl("192.168.1.1");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://192.168.1.1");
    });

    it("detects IP address with port", () => {
      const result = detectAndNormalizeUrl("192.168.1.1:8080");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("http://192.168.1.1:8080");
    });
  });

  describe("whitespace handling", () => {
    it("trims leading/trailing whitespace", () => {
      const result = detectAndNormalizeUrl("  https://example.com  ");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com");
    });

    it("uses only first line for multi-line content", () => {
      const result = detectAndNormalizeUrl("https://example.com\nsome other text");
      expect(result.isUrl).toBe(true);
      expect(result.normalizedUrl).toBe("https://example.com");
    });

    it("handles empty string", () => {
      const result = detectAndNormalizeUrl("");
      expect(result.isUrl).toBe(false);
      expect(result.normalizedUrl).toBeNull();
    });

    it("handles whitespace-only string", () => {
      const result = detectAndNormalizeUrl("   ");
      expect(result.isUrl).toBe(false);
      expect(result.normalizedUrl).toBeNull();
    });
  });

  describe("non-URL text", () => {
    it("rejects plain text", () => {
      expect(detectAndNormalizeUrl("hello world").isUrl).toBe(false);
    });

    it("rejects partial URLs", () => {
      expect(detectAndNormalizeUrl("http//example").isUrl).toBe(false);
    });

    it("rejects single words", () => {
      expect(detectAndNormalizeUrl("example").isUrl).toBe(false);
    });

    it("rejects sentences", () => {
      expect(detectAndNormalizeUrl("This is a sentence.").isUrl).toBe(false);
    });

    it("rejects code snippets", () => {
      expect(detectAndNormalizeUrl("const x = 5;").isUrl).toBe(false);
    });
  });

  describe("originalText preservation", () => {
    it("preserves original text in result", () => {
      const original = "  https://example.com  ";
      const result = detectAndNormalizeUrl(original);
      expect(result.originalText).toBe(original);
    });
  });
});

describe("detectAndNormalizeUrl - additional edge cases", () => {
  it("handles multi-line text and uses first non-empty line", () => {
    // trim() removes leading newlines, split("\n")[0] gets first line
    const result = detectAndNormalizeUrl("\n\nhttps://example.com");
    // After trim: "https://example.com", first line is valid URL
    expect(result.isUrl).toBe(true);
    expect(result.normalizedUrl).toBe("https://example.com");
  });

  it("handles .io domain without path", () => {
    const result = detectAndNormalizeUrl("myapp.io");
    expect(result.isUrl).toBe(true);
    expect(result.normalizedUrl).toBe("https://myapp.io");
  });

  it("handles IP with path", () => {
    const result = detectAndNormalizeUrl("10.0.0.1/api/v1");
    expect(result.isUrl).toBe(true);
    expect(result.normalizedUrl).toBe("http://10.0.0.1/api/v1");
  });
});

describe("looksLikeUrl (tested via detectAndNormalizeUrl)", () => {
  it("detects URLs with protocol", () => {
    expect(detectAndNormalizeUrl("https://example.com").isUrl).toBe(true);
    expect(detectAndNormalizeUrl("ftp://files.example.com").isUrl).toBe(true);
  });

  it("detects email addresses", () => {
    expect(detectAndNormalizeUrl("user@example.com").isUrl).toBe(true);
  });

  it("detects common domains", () => {
    expect(detectAndNormalizeUrl("example.com").isUrl).toBe(true);
    expect(detectAndNormalizeUrl("example.org").isUrl).toBe(true);
  });

  it("detects localhost", () => {
    expect(detectAndNormalizeUrl("localhost:3000").isUrl).toBe(true);
  });

  it("rejects plain text", () => {
    expect(detectAndNormalizeUrl("hello world").isUrl).toBe(false);
  });

  it("rejects empty string", () => {
    expect(detectAndNormalizeUrl("").isUrl).toBe(false);
  });
});

describe("detectAndNormalizeUrl edge cases", () => {
  it("trims leading newlines and detects URL on remaining first line", () => {
    // text.trim() strips leading newlines, so "https://example.com" becomes first line
    const result = detectAndNormalizeUrl("\n\nhttps://example.com");
    expect(result.isUrl).toBe(true);
    expect(result.normalizedUrl).toBe("https://example.com");
  });

  it("returns not-url when trimmed first line is empty", () => {
    // After trim, first line split gives empty — hits line 159
    const result = detectAndNormalizeUrl("   ");
    expect(result.isUrl).toBe(false);
    expect(result.normalizedUrl).toBeNull();
  });
});
