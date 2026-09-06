/**
 * Audit 20260906 — MCP-C03: a note's local images were not served at all.
 *
 * `![caption](picture.png)` resolves under `/note/`, which serves only paths
 * the walker indexed — and the walker indexes markdown. So the image returned
 * 404 even with a valid session. The remedy is a separate route with its own
 * narrow policy, NOT relaxing the index gate, which is what keeps hidden and
 * ignored files unreachable.
 */
import { describe, it, expect } from "vitest";
import {
  assetContentType,
  assetHref,
  hasHiddenSegment,
  isLocalAssetUrl,
} from "./assetRoute";

describe("assetContentType", () => {
  it.each([
    ["a.png", "image/png"],
    ["a.JPG", "image/jpeg"],
    ["nested/dir/a.svg", "image/svg+xml"],
    ["clip.mp4", "video/mp4"],
    ["track.mp3", "audio/mpeg"],
  ])("serves %s", (name, type) => {
    expect(assetContentType(name)).toBe(type);
  });

  // The allowlist is the security boundary: a workspace holds .env files and
  // private keys, and "anything that is not markdown" would serve them.
  it.each([[".env"], ["id_rsa"], ["notes.md"], ["script.sh"], ["a.pdf"], ["noext"]])(
    "refuses %s",
    (name) => {
      expect(assetContentType(name)).toBeNull();
    },
  );
});

describe("hasHiddenSegment", () => {
  it.each([[".git/config"], ["dir/.vmark/state.json"], [".hidden.png"]])(
    "rejects %s",
    (p) => {
      expect(hasHiddenSegment(p)).toBe(true);
    },
  );

  it.each([["a.png"], ["dir/sub/a.png"], ["my.file.png"]])("allows %s", (p) => {
    expect(hasHiddenSegment(p)).toBe(false);
  });
});

describe("isLocalAssetUrl", () => {
  it.each([["picture.png"], ["../up/picture.png"], ["./here.png"], ["dir/a.png"]])(
    "treats %s as local",
    (u) => {
      expect(isLocalAssetUrl(u)).toBe(true);
    },
  );

  it.each([
    ["https://example.com/a.png"],
    ["http://example.com/a.png"],
    ["//example.com/a.png"],
    ["/already/absolute.png"],
    ["data:image/png;base64,AAAA"],
    ["#anchor"],
    [""],
  ])("leaves %s alone", (u) => {
    expect(isLocalAssetUrl(u)).toBe(false);
  });
});

describe("assetHref", () => {
  it("resolves against the note's own directory", () => {
    expect(assetHref("dir/note.md", "picture.png", "tok")).toBe(
      "/asset/dir/picture.png?s=tok",
    );
  });

  it("resolves a parent-relative image", () => {
    expect(assetHref("dir/sub/note.md", "../picture.png", "tok")).toBe(
      "/asset/dir/picture.png?s=tok",
    );
  });

  it("handles a note at the workspace root", () => {
    expect(assetHref("note.md", "picture.png", "tok")).toBe("/asset/picture.png?s=tok");
  });

  // The token is embedded server-side because the browser starts fetching
  // images while the HTML is still parsing — a kb.js rewrite is always too
  // late in the cookie-blocked iframe.
  it("carries the session token", () => {
    expect(assetHref("note.md", "a.png", "s p&c")).toContain("?s=s%20p%26c");
  });

  it("encodes spaces and Unicode in the filename", () => {
    expect(assetHref("note.md", "my picture.png", "t")).toBe(
      "/asset/my%20picture.png?s=t",
    );
    expect(assetHref("note.md", "图片.png", "t")).toBe(
      `/asset/${encodeURIComponent("图片.png")}?s=t`,
    );
  });

  it("decodes an already-encoded source before re-encoding it", () => {
    expect(assetHref("note.md", "my%20picture.png", "t")).toBe(
      "/asset/my%20picture.png?s=t",
    );
  });

  it("preserves the author's own fragment", () => {
    expect(assetHref("note.md", "a.svg#icon", "t")).toBe("/asset/a.svg?s=t#icon");
  });

  // Containment is enforced by the route as well; this keeps the URL builder
  // from manufacturing an escape in the first place.
  it("does not emit a path that climbs above the workspace root", () => {
    expect(assetHref("note.md", "../../../etc/passwd", "t")).not.toContain("..");
  });
});
