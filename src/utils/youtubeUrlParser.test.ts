import { describe, it, expect } from "vitest";

import { parseYoutubeUrl } from "./youtubeUrlParser";

const VALID_ID = "dQw4w9WgXcQ";

describe("parseYoutubeUrl", () => {
  describe("happy path — supported URL shapes", () => {
    it.each([
      ["https://youtu.be/dQw4w9WgXcQ", VALID_ID],
      ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", VALID_ID],
      ["https://youtube.com/watch?v=dQw4w9WgXcQ", VALID_ID],
      ["https://www.youtube.com/embed/dQw4w9WgXcQ", VALID_ID],
      ["https://www.youtube.com/v/dQw4w9WgXcQ", VALID_ID],
      ["https://youtube-nocookie.com/embed/dQw4w9WgXcQ", VALID_ID],
      ["http://youtu.be/dQw4w9WgXcQ", VALID_ID],
    ])("parses %s → %s", (url, expected) => {
      expect(parseYoutubeUrl(url)).toBe(expected);
    });

    it("trims leading/trailing whitespace before parsing", () => {
      expect(parseYoutubeUrl("  https://youtu.be/dQw4w9WgXcQ  ")).toBe(
        VALID_ID,
      );
    });

    it("accepts trailing slash on /embed/ID/", () => {
      expect(
        parseYoutubeUrl("https://www.youtube.com/embed/dQw4w9WgXcQ/"),
      ).toBe(VALID_ID);
    });
  });

  describe("rejected — empty / non-URL input", () => {
    it.each([
      ["empty string", ""],
      ["whitespace-only", "   "],
      ["non-URL garbage", "not a url"],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — wrong protocol", () => {
    it.each([
      ["ftp", "ftp://youtu.be/dQw4w9WgXcQ"],
      ["file", "file:///youtu.be/dQw4w9WgXcQ"],
      ["javascript", "javascript:alert(1)"],
    ])("returns null for %s scheme", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — look-alike or wrong hosts", () => {
    it.each([
      ["look-alike host", "https://notyoutube.com/watch?v=dQw4w9WgXcQ"],
      [
        "subdomain attack",
        "https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ",
      ],
      ["unrelated host", "https://example.com/watch?v=dQw4w9WgXcQ"],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — invalid video IDs on youtu.be", () => {
    it.each([
      ["10-char id", "https://youtu.be/dQw4w9WgXc"],
      ["12-char id", "https://youtu.be/dQw4w9WgXcQQ"],
      ["empty path", "https://youtu.be/"],
      ["invalid char", "https://youtu.be/dQw4w9WgXc!"],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — invalid video ID on /watch", () => {
    it.each([
      ["10-char id", "https://www.youtube.com/watch?v=dQw4w9WgXc"],
      ["12-char id", "https://www.youtube.com/watch?v=dQw4w9WgXcQQ"],
      ["missing v param", "https://www.youtube.com/watch"],
      ["empty v param", "https://www.youtube.com/watch?v="],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — invalid video ID on /embed and /v", () => {
    it.each([
      ["embed 10-char id", "https://www.youtube.com/embed/dQw4w9WgXc"],
      ["v/ 10-char id", "https://www.youtube.com/v/dQw4w9WgXc"],
      ["embed missing id", "https://www.youtube.com/embed/"],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });

  describe("rejected — wrong path on youtube.com", () => {
    it.each([
      ["root", "https://www.youtube.com/"],
      ["/foo path", "https://www.youtube.com/foo"],
      ["/channel path", "https://www.youtube.com/channel/UC123"],
      ["/results path", "https://www.youtube.com/results?search_query=test"],
    ])("returns null for %s", (_label, url) => {
      expect(parseYoutubeUrl(url)).toBeNull();
    });
  });
});
