// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { posix } from "node:path";
import { resolveImageSrc } from "./resolveSrc";
import { bindHostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";
import { ADVERSARIAL_MEDIA_SOURCES } from "@/test/adversarialMediaSources";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

// Real path semantics via `node:path`'s POSIX implementation, for the reason
// `src/test/setup.ts` records at length: a hand-rolled `parts.join("/")`
// disagrees with the real API precisely at the inputs path-safety code exists
// to handle — it leaves `join("/docs", "../a.png")` as `/docs/../a.png`
// instead of resolving it to `/a.png`. This file's local mock WAS that
// approximation, so a `..` path could only ever have been asserted against a
// normalization the app never receives.
vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (p: string) => posix.dirname(p),
  join: async (...parts: string[]) => posix.join(...parts),
}));

/**
 * A host with a window open on `filePath`. The window label is part of the
 * seam's contract (WI-11): a fake that answers "which file" but not "which
 * window" is a host that does not exist, and the resolver correctly treats it
 * as "no document".
 */
const openIn = (filePath: string) => ({
  currentWindowLabel: () => "main",
  activeFilePath: () => filePath,
});

describe("resolveImageSrc", () => {
  beforeEach(() => {
    resetHostDocument();
  });

  it("passes external URLs through untouched", async () => {
    expect(await resolveImageSrc("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(await resolveImageSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("converts an absolute path to an asset URL", async () => {
    expect(await resolveImageSrc("/tmp/pic.png")).toBe("asset://localhost//tmp/pic.png");
  });

  it("resolves a relative path against the active document's directory", async () => {
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("img/a.png")).toBe("asset://localhost//docs/img/a.png");
  });

  it("strips a leading ./ before joining", async () => {
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("./a.png")).toBe("asset://localhost//docs/a.png");
  });

  it("decodes percent-escapes so the filesystem sees real spaces", async () => {
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("my%20pic.png")).toBe("asset://localhost//docs/my pic.png");
  });

  it("returns the original src when no document is open", async () => {
    // The seam's default. An untitled buffer has no directory to resolve
    // against, so the honest answer is "unchanged", not a broken asset URL.
    expect(await resolveImageSrc("a.png")).toBe("a.png");
  });

  it("resolves a parent-relative path against the document directory (#1433)", async () => {
    // The issue's layout: project/images/photo.png referenced from
    // project/notes/report.md. This rendered a broken placeholder.
    bindHostDocument(openIn("/project/notes/report.md"));
    expect(await resolveImageSrc("../images/photo.png")).toBe(
      "asset://localhost//project/images/photo.png",
    );
  });

  it("resolves an embedded `..` segment (#1433)", async () => {
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("img/../pic.png")).toBe("asset://localhost//docs/pic.png");
  });

  it("returns the original src for a relative path that names a directory", async () => {
    // Not a media file, so no branch claims it; it falls through to "unknown
    // format" and is handed back. Harmless: an unresolved relative src in the
    // webview has the app origin as its base, not `file://`, so it cannot
    // read the filesystem.
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("../")).toBe("../");
  });

  // The class this shares with the other two resolvers: a source none of the
  // branches claims must be REFUSED when it carries a scheme, not handed back.
  // See src/test/adversarialMediaSources.ts.
  it.each(ADVERSARIAL_MEDIA_SOURCES)(
    "refuses %s",
    async (_label, src) => {
      bindHostDocument(openIn("/docs/note.md"));
      expect(await resolveImageSrc(src)).toBe("");
    },
  );

  it("recognises an angle-bracket-wrapped external URL after decoding", async () => {
    // Classification ran on the RAW string, so the brackets hid the scheme and
    // the bracketed string came back — a src no loader can fetch.
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("<https://example.com/a b.png>")).toBe(
      "https://example.com/a b.png",
    );
  });

  it("falls back to the original src when path joining throws", async () => {
    bindHostDocument({
      currentWindowLabel: () => "main",
      activeFilePath: () => {
        throw new Error("store exploded");
      },
    });
    await expect(resolveImageSrc("a.png")).resolves.toBe("a.png");
  });

  it("leaves an empty src alone", async () => {
    expect(await resolveImageSrc("")).toBe("");
  });
});
