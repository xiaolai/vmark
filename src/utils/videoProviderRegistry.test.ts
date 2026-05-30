import { describe, it, expect } from "vitest";

import {
  buildEmbedUrl,
  detectProviderFromIframeSrc,
  extractVideoIdFromSrc,
  getProviderConfig,
  parseVideoUrl,
  type VideoProvider,
} from "./videoProviderRegistry";

const VIMEO_ID = "123456789";
const BILIBILI_ID = "BV1xx411c7mD";
const YOUTUBE_ID = "dQw4w9WgXcQ";

describe("parseVideoUrl — Vimeo routing", () => {
  describe("happy path", () => {
    it.each([
      ["https://vimeo.com/123456789", VIMEO_ID],
      ["https://www.vimeo.com/123456789", VIMEO_ID],
      ["http://vimeo.com/123456789", VIMEO_ID],
      ["https://player.vimeo.com/video/123456789", VIMEO_ID],
      ["https://player.vimeo.com/video/123456789?autoplay=1", VIMEO_ID],
    ])("parses %s → %s", (url, expected) => {
      const result = parseVideoUrl(url);
      expect(result).toEqual({ provider: "vimeo", videoId: expected });
    });

    it("trims leading/trailing whitespace before parsing", () => {
      expect(parseVideoUrl("  https://vimeo.com/1  ")).toEqual({
        provider: "vimeo",
        videoId: "1",
      });
    });
  });

  describe("rejects non-video paths", () => {
    it.each([
      "https://vimeo.com/channels/staffpicks/123",
      "https://vimeo.com/groups/foo/videos/123",
      "https://vimeo.com/user42/123",
      "https://vimeo.com/showcase/123",
      "https://vimeo.com/manage/videos/123",
      "https://vimeo.com/ondemand/foo/123",
      "https://vimeo.com/categories/animation",
    ])("rejects %s", (url) => {
      expect(parseVideoUrl(url)).toBeNull();
    });

    it("rejects vimeo.com with non-numeric ID", () => {
      expect(parseVideoUrl("https://vimeo.com/abc123")).toBeNull();
    });

    it("rejects vimeo.com with empty path", () => {
      expect(parseVideoUrl("https://vimeo.com/")).toBeNull();
    });

    it("rejects player.vimeo.com without /video/ID prefix", () => {
      expect(parseVideoUrl("https://player.vimeo.com/other/123")).toBeNull();
    });

    it("rejects non-http(s) schemes", () => {
      expect(parseVideoUrl("ftp://vimeo.com/123")).toBeNull();
    });
  });
});

describe("parseVideoUrl — Bilibili routing", () => {
  describe("happy path", () => {
    it.each([
      ["https://www.bilibili.com/video/BV1xx411c7mD", BILIBILI_ID],
      ["https://bilibili.com/video/BV1xx411c7mD", BILIBILI_ID],
      ["http://bilibili.com/video/BV1xx411c7mD", BILIBILI_ID],
      ["https://www.bilibili.com/video/BV1xx411c7mD/", BILIBILI_ID],
      ["https://www.bilibili.com/video/BV1xx411c7mD?p=2", BILIBILI_ID],
      [
        "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD",
        BILIBILI_ID,
      ],
    ])("parses %s → %s", (url, expected) => {
      const result = parseVideoUrl(url);
      expect(result).toEqual({ provider: "bilibili", videoId: expected });
    });
  });

  describe("rejects invalid BV IDs", () => {
    it("rejects bilibili.com without /video/ prefix", () => {
      expect(parseVideoUrl("https://bilibili.com/BV1xx411c7mD")).toBeNull();
    });

    it("rejects bilibili.com with malformed BV ID", () => {
      expect(parseVideoUrl("https://bilibili.com/video/abc123")).toBeNull();
    });

    it("rejects player.bilibili.com without bvid query", () => {
      expect(
        parseVideoUrl("https://player.bilibili.com/player.html"),
      ).toBeNull();
    });

    it("rejects player.bilibili.com with malformed bvid", () => {
      expect(
        parseVideoUrl("https://player.bilibili.com/player.html?bvid=bad"),
      ).toBeNull();
    });

    it("rejects b23.tv short URLs (require redirect resolution)", () => {
      expect(parseVideoUrl("https://b23.tv/abcdef")).toBeNull();
    });
  });
});

describe("parseVideoUrl — top-level routing", () => {
  it("routes YouTube URL to youtube provider", () => {
    expect(parseVideoUrl(`https://youtu.be/${YOUTUBE_ID}`)).toEqual({
      provider: "youtube",
      videoId: YOUTUBE_ID,
    });
  });

  it("routes YouTube watch URL to youtube provider", () => {
    expect(
      parseVideoUrl(`https://www.youtube.com/watch?v=${YOUTUBE_ID}`),
    ).toEqual({ provider: "youtube", videoId: YOUTUBE_ID });
  });

  it("routes Vimeo URL to vimeo provider", () => {
    expect(parseVideoUrl(`https://vimeo.com/${VIMEO_ID}`)).toEqual({
      provider: "vimeo",
      videoId: VIMEO_ID,
    });
  });

  it("routes Bilibili URL to bilibili provider", () => {
    expect(
      parseVideoUrl(`https://www.bilibili.com/video/${BILIBILI_ID}`),
    ).toEqual({ provider: "bilibili", videoId: BILIBILI_ID });
  });

  it("returns null for unknown provider", () => {
    expect(parseVideoUrl("https://example.com/video/123")).toBeNull();
  });

  it("returns null for non-URL strings", () => {
    expect(parseVideoUrl("not a url")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseVideoUrl("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(parseVideoUrl("   ")).toBeNull();
  });
});

describe("buildEmbedUrl", () => {
  it("builds YouTube nocookie embed URL", () => {
    expect(buildEmbedUrl("youtube", YOUTUBE_ID)).toBe(
      `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
    );
  });

  it("builds Vimeo player embed URL", () => {
    expect(buildEmbedUrl("vimeo", VIMEO_ID)).toBe(
      `https://player.vimeo.com/video/${VIMEO_ID}`,
    );
  });

  it("builds Bilibili player embed URL", () => {
    expect(buildEmbedUrl("bilibili", BILIBILI_ID)).toBe(
      `https://player.bilibili.com/player.html?bvid=${BILIBILI_ID}`,
    );
  });

  it("returns about:blank for unknown provider", () => {
    expect(buildEmbedUrl("unknown" as VideoProvider, "123")).toBe(
      "about:blank",
    );
  });
});

describe("detectProviderFromIframeSrc", () => {
  it.each([
    [`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`, "youtube"],
    [`https://www.youtube.com/embed/${YOUTUBE_ID}`, "youtube"],
    [`https://player.vimeo.com/video/${VIMEO_ID}`, "vimeo"],
    [
      `https://player.bilibili.com/player.html?bvid=${BILIBILI_ID}`,
      "bilibili",
    ],
  ])("detects %s → %s", (src, provider) => {
    expect(detectProviderFromIframeSrc(src)).toBe(provider);
  });

  it("returns null for unrelated iframe src", () => {
    expect(
      detectProviderFromIframeSrc("https://example.com/iframe"),
    ).toBeNull();
  });

  it("returns null for empty src", () => {
    expect(detectProviderFromIframeSrc("")).toBeNull();
  });
});

describe("extractVideoIdFromSrc", () => {
  it("extracts YouTube ID from iframe src", () => {
    expect(
      extractVideoIdFromSrc(
        "youtube",
        `https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}`,
      ),
    ).toBe(YOUTUBE_ID);
  });

  it("extracts Vimeo ID from iframe src", () => {
    expect(
      extractVideoIdFromSrc(
        "vimeo",
        `https://player.vimeo.com/video/${VIMEO_ID}`,
      ),
    ).toBe(VIMEO_ID);
  });

  it("extracts Bilibili ID from iframe src", () => {
    expect(
      extractVideoIdFromSrc(
        "bilibili",
        `https://player.bilibili.com/player.html?bvid=${BILIBILI_ID}`,
      ),
    ).toBe(BILIBILI_ID);
  });

  it("returns null for unknown provider", () => {
    expect(
      extractVideoIdFromSrc("unknown" as VideoProvider, "any-src"),
    ).toBeNull();
  });

  it("returns null when src does not match provider's URL shape", () => {
    expect(
      extractVideoIdFromSrc("vimeo", "https://example.com/not-vimeo"),
    ).toBeNull();
  });
});

describe("build → detect → extract symmetry", () => {
  it.each<[VideoProvider, string]>([
    ["youtube", YOUTUBE_ID],
    ["vimeo", VIMEO_ID],
    ["bilibili", BILIBILI_ID],
  ])("round-trips %s ID through build/detect/extract", (provider, id) => {
    const src = buildEmbedUrl(provider, id);
    expect(detectProviderFromIframeSrc(src)).toBe(provider);
    expect(extractVideoIdFromSrc(provider, src)).toBe(id);
  });
});

describe("getProviderConfig", () => {
  it.each<VideoProvider>(["youtube", "vimeo", "bilibili"])(
    "returns config for %s",
    (provider) => {
      const config = getProviderConfig(provider);
      expect(config?.name).toBe(provider);
      expect(typeof config?.defaultWidth).toBe("number");
      expect(typeof config?.defaultHeight).toBe("number");
      expect(typeof config?.aspectRatio).toBe("string");
    },
  );

  it("returns undefined for unknown provider", () => {
    expect(getProviderConfig("unknown" as VideoProvider)).toBeUndefined();
  });
});
