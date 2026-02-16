/**
 * Tests for YouTube URL parser — all URL formats, edge cases, invalid inputs.
 */

import { describe, it, expect } from "vitest";
import { parseYoutubeUrl, isYoutubeUrl } from "../urlParser";

describe("parseYoutubeUrl", () => {
  describe("standard watch URLs", () => {
    it("parses youtube.com/watch?v=VIDEO_ID", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses without www", () => {
      expect(parseYoutubeUrl("https://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses http URLs", () => {
      expect(parseYoutubeUrl("http://youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses with extra query params", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s")).toBe("dQw4w9WgXcQ");
    });

    it("parses with v param not first", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/watch?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&v=abc12345678")).toBe("abc12345678");
    });
  });

  describe("short URLs (youtu.be)", () => {
    it("parses youtu.be/VIDEO_ID", () => {
      expect(parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses with timestamp", () => {
      expect(parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQ?t=30")).toBe("dQw4w9WgXcQ");
    });
  });

  describe("embed URLs", () => {
    it("parses youtube.com/embed/VIDEO_ID", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses youtube-nocookie.com/embed/VIDEO_ID", () => {
      expect(parseYoutubeUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });

    it("parses with query params after embed ID", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ?start=30&autoplay=1")).toBe("dQw4w9WgXcQ");
    });
  });

  describe("v/ URLs", () => {
    it("parses youtube.com/v/VIDEO_ID", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/v/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(parseYoutubeUrl("")).toBeNull();
    });

    it("returns null for non-YouTube URL", () => {
      expect(parseYoutubeUrl("https://vimeo.com/123456")).toBeNull();
    });

    it("returns null for YouTube URL without video ID", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/")).toBeNull();
    });

    it("returns null for YouTube channel URLs", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/@user")).toBeNull();
    });

    it("returns null for malformed URLs", () => {
      expect(parseYoutubeUrl("not-a-url")).toBeNull();
    });

    it("rejects look-alike domains (hostname anchoring)", () => {
      expect(parseYoutubeUrl("https://notyoutube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
      expect(parseYoutubeUrl("https://fakeyoutu.be/dQw4w9WgXcQ")).toBeNull();
    });

    it("rejects YouTube in query string (not hostname)", () => {
      expect(parseYoutubeUrl("https://example.com/?q=youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    });

    it("trims whitespace from input", () => {
      expect(parseYoutubeUrl("  https://youtu.be/dQw4w9WgXcQ  ")).toBe("dQw4w9WgXcQ");
    });

    it("rejects IDs with trailing characters (boundary check)", () => {
      expect(parseYoutubeUrl("https://youtu.be/dQw4w9WgXcQextra")).toBeNull();
    });

    it("returns null for watch URL without v param", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/watch")).toBeNull();
    });

    it("handles trailing slashes", () => {
      expect(parseYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ/")).toBe("dQw4w9WgXcQ");
    });
  });
});

describe("isYoutubeUrl", () => {
  it("returns true for YouTube watch URL", () => {
    expect(isYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });

  it("returns true for youtu.be URL", () => {
    expect(isYoutubeUrl("https://youtu.be/dQw4w9WgXcQ")).toBe(true);
  });

  it("returns true for embed URL", () => {
    expect(isYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(true);
  });

  it("returns false for non-YouTube", () => {
    expect(isYoutubeUrl("https://example.com")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isYoutubeUrl("")).toBe(false);
  });
});
