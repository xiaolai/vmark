/**
 * Tests for sourceMediaDecoration — media block detection with bounded lookahead.
 *
 * Imports the real detection helpers (matchMediaOpenTag, classifyIframe,
 * isSingleLineMediaBlock, findMediaCloseLine, findMediaBlocks) rather than
 * duplicating the regexes.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIframe,
  matchMediaOpenTag,
  isSingleLineMediaBlock,
  findMediaCloseLine,
  findMediaBlocks,
  type MediaDocLike,
} from "./sourceMediaDecoration";

/** Build a minimal CodeMirror-doc-shaped object from lines of text. */
function docFromLines(lines: string[]): MediaDocLike {
  let from = 0;
  const lineInfos = lines.map((text) => {
    const info = { text, from };
    from += text.length + 1;
    return info;
  });
  return {
    lines: lines.length,
    line: (n: number) => lineInfos[n - 1],
  };
}

describe("matchMediaOpenTag", () => {
  it("matches <video> tag", () => {
    expect(matchMediaOpenTag('<video src="test.mp4">')).toEqual({ tag: "video", type: "video" });
  });

  it("matches <audio> tag", () => {
    expect(matchMediaOpenTag('<audio src="test.mp3">')).toEqual({ tag: "audio", type: "audio" });
  });

  it("matches indented tags", () => {
    expect(matchMediaOpenTag("  <video controls>")).toEqual({ tag: "video", type: "video" });
  });

  it("classifies a YouTube iframe", () => {
    expect(matchMediaOpenTag('<iframe src="https://www.youtube.com/embed/abc">')).toEqual({
      tag: "iframe",
      type: "youtube",
    });
  });

  it("returns null for <div> or other tags", () => {
    expect(matchMediaOpenTag("<div>hello</div>")).toBeNull();
  });

  it("returns null for <videos> (extra characters)", () => {
    // "videos" has 's' after "video" — the pattern requires whitespace or > after the tag name
    expect(matchMediaOpenTag("<videos>")).toBeNull();
  });

  it("returns null for an iframe with unknown src", () => {
    expect(matchMediaOpenTag('<iframe src="https://example.com">')).toBeNull();
  });

  it("returns null for non-media text", () => {
    expect(matchMediaOpenTag("<p>Hello</p>")).toBeNull();
  });
});

describe("classifyIframe", () => {
  it("detects YouTube", () => {
    expect(classifyIframe('<iframe src="https://www.youtube.com/embed/abc">')).toBe("youtube");
  });

  it("detects YouTube-nocookie", () => {
    expect(classifyIframe('<iframe src="https://www.youtube-nocookie.com/embed/abc">')).toBe("youtube");
  });

  it("detects Vimeo", () => {
    expect(classifyIframe('<iframe src="https://player.vimeo.com/video/123">')).toBe("vimeo");
  });

  it("detects Bilibili", () => {
    expect(classifyIframe('<iframe src="https://player.bilibili.com/player.html?bvid=abc">')).toBe("bilibili");
  });

  it("returns null for unknown iframe src", () => {
    expect(classifyIframe('<iframe src="https://example.com">')).toBeNull();
  });
});

describe("isSingleLineMediaBlock", () => {
  it("detects self-closing tag", () => {
    expect(isSingleLineMediaBlock('<video src="test.mp4" />', "video")).toBe(true);
  });

  it("detects self-closing with trailing whitespace", () => {
    expect(isSingleLineMediaBlock("<video />  ", "video")).toBe(true);
  });

  it("detects same-line close tag", () => {
    expect(isSingleLineMediaBlock("<audio src=\"a.mp3\"></audio>", "audio")).toBe(true);
  });

  it("returns false for an open-only line", () => {
    expect(isSingleLineMediaBlock("<video controls>", "video")).toBe(false);
  });
});

describe("findMediaCloseLine", () => {
  it("finds the closing tag on a later line", () => {
    const doc = docFromLines(["<video controls>", '  <source src="a.mp4">', "</video>"]);
    expect(findMediaCloseLine(doc, "video", 1)).toBe(3);
  });

  it("returns null when no closing tag exists", () => {
    const doc = docFromLines(["<video controls>", "text", "more text"]);
    expect(findMediaCloseLine(doc, "video", 1)).toBeNull();
  });

  it("bounds the lookahead to 200 lines", () => {
    const lines = ["<video controls>", ...Array.from({ length: 250 }, () => "filler"), "</video>"];
    const doc = docFromLines(lines);
    expect(findMediaCloseLine(doc, "video", 1)).toBeNull();
  });
});

describe("findMediaBlocks", () => {
  it("returns an empty array for a doc without media", () => {
    const doc = docFromLines(["# Heading", "Some text", ""]);
    expect(findMediaBlocks(doc)).toEqual([]);
  });

  it("detects a multi-line video block through its closing tag", () => {
    const doc = docFromLines([
      "before",
      "<video controls>",
      '  <source src="a.mp4">',
      "</video>",
      "after",
    ]);
    expect(findMediaBlocks(doc)).toEqual([{ type: "video", startLine: 2, endLine: 4 }]);
  });

  it("detects a self-closing tag as a single-line block", () => {
    const doc = docFromLines(['<video src="a.mp4" />', "text"]);
    expect(findMediaBlocks(doc)).toEqual([{ type: "video", startLine: 1, endLine: 1 }]);
  });

  it("detects a same-line open+close as a single-line block", () => {
    const doc = docFromLines(['<audio src="a.mp3"></audio>']);
    expect(findMediaBlocks(doc)).toEqual([{ type: "audio", startLine: 1, endLine: 1 }]);
  });

  it("treats an unclosed block as single-line (bounded lookahead fallback)", () => {
    const doc = docFromLines(["<video controls>", "no close tag here", "still nothing"]);
    expect(findMediaBlocks(doc)).toEqual([{ type: "video", startLine: 1, endLine: 1 }]);
  });

  it("detects multiple blocks of different types", () => {
    const doc = docFromLines([
      '<video src="a.mp4" />',
      "text",
      '<iframe src="https://player.vimeo.com/video/1"></iframe>',
      '<audio controls>',
      "</audio>",
    ]);
    expect(findMediaBlocks(doc)).toEqual([
      { type: "video", startLine: 1, endLine: 1 },
      { type: "vimeo", startLine: 3, endLine: 3 },
      { type: "audio", startLine: 4, endLine: 5 },
    ]);
  });

  it("skips unknown iframes entirely", () => {
    const doc = docFromLines(['<iframe src="https://example.com/embed"></iframe>']);
    expect(findMediaBlocks(doc)).toEqual([]);
  });

  it("resumes scanning after a closed block (no overlapping rescans)", () => {
    const doc = docFromLines([
      "<video controls>",
      "</video>",
      "<video controls>",
      "</video>",
    ]);
    expect(findMediaBlocks(doc)).toEqual([
      { type: "video", startLine: 1, endLine: 2 },
      { type: "video", startLine: 3, endLine: 4 },
    ]);
  });
});
