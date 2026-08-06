import { describe, it, expect } from "vitest";

import {
  buildEmbedUrl,
  detectProviderFromIframeSrc,
  extractVideoIdFromSrc,
  extractVideoInfoFromSrc,
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

  describe("parses documented container video schemas", () => {
    it.each([
      ["https://vimeo.com/channels/staffpicks/123", "123"],
      ["https://vimeo.com/groups/foo/videos/123", "123"],
      ["https://vimeo.com/ondemand/foo/123", "123"],
      ["https://vimeo.com/album/77/video/123", "123"],
      ["https://vimeo.com/showcase/77/video/123", "123"],
    ])("parses %s", (url, id) => {
      expect(parseVideoUrl(url)).toEqual({ provider: "vimeo", videoId: id });
    });
  });

  describe("rejects non-video paths", () => {
    it.each([
      "https://vimeo.com/user42/123",
      "https://vimeo.com/showcase/123",
      "https://vimeo.com/manage/videos/123",
      "https://vimeo.com/channels/staffpicks",
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
      expect(typeof config?.defaultWidth).toBe("number");
      expect(typeof config?.defaultHeight).toBe("number");
      expect(typeof config?.aspectRatio).toBe("string");
    },
  );

  it("returns undefined for unknown provider", () => {
    expect(getProviderConfig("unknown" as VideoProvider)).toBeUndefined();
  });
});

describe("hardening (audit round)", () => {
  it("rejects malformed player paths instead of extracting a partial ID", () => {
    expect(parseVideoUrl("https://player.vimeo.com/video/123abc")).toBeNull();
    expect(
      parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mDgarbage")
    ).toBeNull();
  });

  it("accepts trailing slashes on anchored player paths", () => {
    expect(parseVideoUrl("https://player.vimeo.com/video/123456/")).toEqual({
      provider: "vimeo",
      videoId: "123456",
    });
    expect(parseVideoUrl("https://www.bilibili.com/video/BV1xx411c7mD/")).toEqual({
      provider: "bilibili",
      videoId: "BV1xx411c7mD",
    });
  });

  it("requires the bilibili embed player path to be /player.html", () => {
    expect(
      parseVideoUrl("https://player.bilibili.com/anything?bvid=BV1xx411c7mD")
    ).toBeNull();
    expect(
      parseVideoUrl("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD")
    ).toEqual({ provider: "bilibili", videoId: "BV1xx411c7mD" });
  });

  it("does not detect lookalike domains as providers", () => {
    expect(
      detectProviderFromIframeSrc("https://notyoutube.com/embed/dQw4w9WgXcQ")
    ).toBeNull();
    expect(
      detectProviderFromIframeSrc(
        "https://evil.example/?u=player.vimeo.com/video/123"
      )
    ).toBeNull();
  });

  it("refuses to build embed URLs from malformed IDs", () => {
    expect(buildEmbedUrl("youtube", "../evil")).toBe("about:blank");
    expect(buildEmbedUrl("vimeo", "123?autoplay=1")).toBe("about:blank");
    expect(buildEmbedUrl("bilibili", "BV1xx411c7mD&danmaku=1")).toBe("about:blank");
  });

  it("handles empty src in direct extraction (parser guards are reachable)", () => {
    expect(extractVideoIdFromSrc("vimeo", "")).toBeNull();
    expect(extractVideoIdFromSrc("bilibili", "")).toBeNull();
  });

  it("exposes frozen configs so callers cannot mutate global behavior", () => {
    const config = getProviderConfig("youtube");
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe("ID validation surface (audit round 2)", () => {
  it("exposes a validation closure, not a mutable RegExp", () => {
    const config = getProviderConfig("bilibili");
    // Object.freeze cannot protect a RegExp (.compile() swaps the pattern
    // before throwing), so the config must not expose one at all.
    expect("idPattern" in (config ?? {})).toBe(false);
    expect(config?.isValidId("BV1xx411c7mD")).toBe(true);
    expect(config?.isValidId("nope")).toBe(false);
  });
});

describe("Vimeo unlisted privacy hash (WI-6)", () => {
  it("parses the unlisted path form vimeo.com/{id}/{hash}", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789/abcDEF123")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
      privacyHash: "abcDEF123",
    });
  });

  it("parses the ?h= form on both vimeo.com and player URLs", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789?h=beef1234")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
      privacyHash: "beef1234",
    });
    expect(
      parseVideoUrl("https://player.vimeo.com/video/123456789?h=beef1234")
    ).toEqual({ provider: "vimeo", videoId: "123456789", privacyHash: "beef1234" });
  });

  it("ordinary vimeo URLs carry no hash", () => {
    expect(parseVideoUrl("https://vimeo.com/123456789")).toEqual({
      provider: "vimeo",
      videoId: "123456789",
      privacyHash: undefined,
    });
  });

  it("builds embed URLs with the hash, validated", () => {
    expect(buildEmbedUrl("vimeo", "123456789", { privacyHash: "beef1234" })).toBe(
      "https://player.vimeo.com/video/123456789?h=beef1234"
    );
    // Malformed hashes are dropped, not interpolated.
    expect(buildEmbedUrl("vimeo", "123456789", { privacyHash: "x&autoplay=1" })).toBe(
      "https://player.vimeo.com/video/123456789"
    );
    // Hash is vimeo-only.
    expect(buildEmbedUrl("youtube", "dQw4w9WgXcQ", { privacyHash: "beef" })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
    );
  });

  it("round-trips: unlisted URL → parse → embed src → extract (DoD)", () => {
    const parsed = parseVideoUrl("https://vimeo.com/123456789/abcDEF123");
    expect(parsed?.privacyHash).toBe("abcDEF123");
    const embedSrc = buildEmbedUrl("vimeo", parsed!.videoId, {
      privacyHash: parsed!.privacyHash,
    });
    expect(embedSrc).toContain("h=abcDEF123");
    const back = extractVideoInfoFromSrc("vimeo", embedSrc);
    expect(back).toEqual({ videoId: "123456789", privacyHash: "abcDEF123" });
  });
});
