/**
 * Tests for video provider registry — URL parsing, embed URL generation, iframe detection.
 */

import { describe, it, expect } from "vitest";
import {
  parseVideoUrl,
  buildEmbedUrl,
  detectProviderFromIframeSrc,
  getProviderConfig,
  type VideoProvider,
} from "../videoProviderRegistry";

describe("parseVideoUrl", () => {
  describe("YouTube URLs", () => {
    it("parses youtube.com/watch?v=VIDEO_ID", () => {
      const result = parseVideoUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
      expect(result).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });

    it("parses youtu.be/VIDEO_ID", () => {
      const result = parseVideoUrl("https://youtu.be/dQw4w9WgXcQ");
      expect(result).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });

    it("parses youtube-nocookie.com/embed/VIDEO_ID", () => {
      const result = parseVideoUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
      expect(result).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });

    it("parses youtube.com/embed/VIDEO_ID", () => {
      const result = parseVideoUrl("https://www.youtube.com/embed/dQw4w9WgXcQ");
      expect(result).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });

    it("parses youtube.com/v/VIDEO_ID", () => {
      const result = parseVideoUrl("https://www.youtube.com/v/dQw4w9WgXcQ");
      expect(result).toEqual({ provider: "youtube", videoId: "dQw4w9WgXcQ" });
    });
  });

  describe("Vimeo URLs", () => {
    it("parses vimeo.com/{id}", () => {
      const result = parseVideoUrl("https://vimeo.com/123456789");
      expect(result).toEqual({ provider: "vimeo", videoId: "123456789" });
    });

    it("parses vimeo.com/{id} with www", () => {
      const result = parseVideoUrl("https://www.vimeo.com/123456789");
      expect(result).toEqual({ provider: "vimeo", videoId: "123456789" });
    });

    it("parses player.vimeo.com/video/{id}", () => {
      const result = parseVideoUrl("https://player.vimeo.com/video/123456789");
      expect(result).toEqual({ provider: "vimeo", videoId: "123456789" });
    });

    it("parses vimeo.com/{id} with query params", () => {
      const result = parseVideoUrl("https://vimeo.com/123456789?h=abc123");
      expect(result).toEqual({ provider: "vimeo", videoId: "123456789" });
    });

    it("returns null for vimeo channel URLs", () => {
      expect(parseVideoUrl("https://vimeo.com/channels/staffpicks")).toBeNull();
    });

    it("returns null for vimeo user profile URLs", () => {
      expect(parseVideoUrl("https://vimeo.com/user12345")).toBeNull();
    });

    it("returns null for vimeo showcase URLs", () => {
      expect(parseVideoUrl("https://vimeo.com/showcase/123")).toBeNull();
    });

    it("rejects look-alike vimeo domains", () => {
      expect(parseVideoUrl("https://notvimeo.com/123456789")).toBeNull();
    });
  });

  describe("Bilibili URLs", () => {
    it("parses bilibili.com/video/BVxxxxxx", () => {
      const result = parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD");
      expect(result).toEqual({ provider: "bilibili", videoId: "BV1xx411c7mD" });
    });

    it("parses bilibili.com/video/BVxxxxxx with query params", () => {
      const result = parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD?p=2");
      expect(result).toEqual({ provider: "bilibili", videoId: "BV1xx411c7mD" });
    });

    it("parses bilibili.com/video/BVxxxxxx without www", () => {
      const result = parseVideoUrl("https://bilibili.com/video/BV1xx411c7mD");
      expect(result).toEqual({ provider: "bilibili", videoId: "BV1xx411c7mD" });
    });

    it("parses player.bilibili.com with bvid param", () => {
      const result = parseVideoUrl("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD");
      expect(result).toEqual({ provider: "bilibili", videoId: "BV1xx411c7mD" });
    });

    it("rejects b23.tv short URLs (requires redirect to resolve BV ID)", () => {
      expect(parseVideoUrl("https://b23.tv/abc1234")).toBeNull();
    });

    it("rejects look-alike bilibili domains", () => {
      expect(parseVideoUrl("https://notbilibili.com/video/BV1xx411c7mD")).toBeNull();
    });

    it("rejects bilibili non-video paths", () => {
      expect(parseVideoUrl("https://www.bilibili.com/anime/1234")).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("returns null for empty string", () => {
      expect(parseVideoUrl("")).toBeNull();
    });

    it("returns null for non-URL text", () => {
      expect(parseVideoUrl("not a url")).toBeNull();
    });

    it("returns null for unrecognized domains", () => {
      expect(parseVideoUrl("https://example.com/video/123")).toBeNull();
    });

    it("trims whitespace", () => {
      const result = parseVideoUrl("  https://vimeo.com/123456789  ");
      expect(result).toEqual({ provider: "vimeo", videoId: "123456789" });
    });

    it("rejects ftp protocol", () => {
      expect(parseVideoUrl("ftp://youtube.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    });

    it("rejects javascript protocol", () => {
      expect(parseVideoUrl("javascript:alert(1)")).toBeNull();
    });
  });
});

describe("buildEmbedUrl", () => {
  it("builds YouTube embed URL (privacy-enhanced)", () => {
    expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ")).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
  });

  it("builds Vimeo embed URL", () => {
    expect(buildEmbedUrl("vimeo", "123456789")).toBe(
      "https://player.vimeo.com/video/123456789"
    );
  });

  it("builds Bilibili embed URL", () => {
    expect(buildEmbedUrl("bilibili", "BV1xx411c7mD")).toBe(
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD"
    );
  });

  it("returns about:blank for unknown provider", () => {
    expect(buildEmbedUrl("unknown" as VideoProvider, "123")).toBe("about:blank");
  });
});

describe("detectProviderFromIframeSrc", () => {
  it("detects YouTube from youtube-nocookie.com", () => {
    expect(
      detectProviderFromIframeSrc("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ")
    ).toBe("youtube");
  });

  it("detects YouTube from youtube.com", () => {
    expect(
      detectProviderFromIframeSrc("https://www.youtube.com/embed/dQw4w9WgXcQ")
    ).toBe("youtube");
  });

  it("detects Vimeo from player.vimeo.com", () => {
    expect(
      detectProviderFromIframeSrc("https://player.vimeo.com/video/123456789")
    ).toBe("vimeo");
  });

  it("detects Bilibili from player.bilibili.com", () => {
    expect(
      detectProviderFromIframeSrc("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD")
    ).toBe("bilibili");
  });

  it("returns null for unknown domains", () => {
    expect(detectProviderFromIframeSrc("https://example.com/embed/123")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(detectProviderFromIframeSrc("")).toBeNull();
  });
});

describe("getProviderConfig", () => {
  it("returns YouTube config with correct defaults", () => {
    const config = getProviderConfig("youtube");
    expect(config).toBeDefined();
    expect(config!.defaultWidth).toBe(560);
    expect(config!.defaultHeight).toBe(315);
    expect(config!.aspectRatio).toBe("56.25%");
  });

  it("returns Vimeo config with correct defaults", () => {
    const config = getProviderConfig("vimeo");
    expect(config).toBeDefined();
    expect(config!.defaultWidth).toBe(560);
    expect(config!.defaultHeight).toBe(315);
    expect(config!.aspectRatio).toBe("56.25%");
  });

  it("returns Bilibili config with correct defaults", () => {
    const config = getProviderConfig("bilibili");
    expect(config).toBeDefined();
    expect(config!.defaultWidth).toBe(560);
    expect(config!.defaultHeight).toBe(350);
    expect(config!.aspectRatio).toBe("62.5%");
  });

  it("returns undefined for unknown provider", () => {
    expect(getProviderConfig("unknown" as VideoProvider)).toBeUndefined();
  });
});
