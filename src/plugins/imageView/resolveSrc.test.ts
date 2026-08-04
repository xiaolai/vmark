import { describe, it, expect, beforeEach, vi } from "vitest";
import { resolveImageSrc } from "./resolveSrc";
import { bindHostDocument, resetHostDocument } from "@/plugins/shared/hostDocument";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

vi.mock("@tauri-apps/api/path", () => ({
  dirname: async (p: string) => p.slice(0, p.lastIndexOf("/")),
  join: async (...parts: string[]) => parts.join("/"),
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

  it("returns empty for an embedded traversal segment", async () => {
    // `isRelativePath` only rejects a LEADING `../`, so this one reaches
    // `validateImagePath` — the layer that rejects `..` anywhere — and is
    // blanked rather than resolved into the user's home directory.
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("img/../../../etc/passwd")).toBe("");
  });

  it("leaves a leading-`../` path unresolved rather than blanking it", async () => {
    // Rejected one layer earlier, by `isRelativePath`, so it falls through to
    // "unknown format". Harmless: an unresolved relative src in the webview
    // has the app origin as its base, not `file://`, so it cannot read the
    // filesystem. Asserted so the two rejection layers stay distinguishable.
    bindHostDocument(openIn("/docs/note.md"));
    expect(await resolveImageSrc("../../../etc/passwd")).toBe("../../../etc/passwd");
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
