// @vitest-environment node
// Markdown broken-link checker. Validates that local link / image
// targets referenced from a markdown file actually exist on disk.

import { describe, it, expect, vi, beforeEach } from "vitest";

const existsMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: existsMock }));

import { checkLocalLinks, isExternalUrl, resolveMarkdownUrl } from "./check";

beforeEach(() => {
  existsMock.mockReset();
});

describe("checkLocalLinks", () => {
  it("returns no diagnostics when all links resolve", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[link](./target.md)\n![img](./pic.png)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
  });

  it("flags a missing markdown link", async () => {
    existsMock.mockImplementation((p: string) =>
      Promise.resolve(p.includes("target.md") ? false : true),
    );
    const md = "[broken](./target.md)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags.length).toBe(1);
    expect(diags[0].messageKey).toMatch(/linkNotFound/);
    expect(diags[0].messageParams?.path).toContain("target.md");
  });

  it("flags a missing image", async () => {
    existsMock.mockImplementation((p: string) =>
      Promise.resolve(p.includes("missing") ? false : true),
    );
    const md = "![alt](./missing.png)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags.length).toBe(1);
  });

  it("ignores http(s) URLs", async () => {
    existsMock.mockResolvedValue(false);
    const md =
      "[ext](https://example.com)\n[ftp](ftp://example.com/file)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("ignores fragment-only links (#anchor)", async () => {
    const md = "[anchor](#section)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("ignores mailto: and tel: schemes", async () => {
    const md =
      "[email](mailto:foo@bar.com)\n[call](tel:+1234567890)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("ignores generic URI schemes (obsidian:, vscode:, zotero:)", async () => {
    // Regression (Codex audit): only a fixed scheme list was exempt, so
    // app-protocol URIs were resolved as file paths → false M001/M002.
    existsMock.mockResolvedValue(false);
    const md =
      "[o](obsidian://open?vault=v&file=note)\n" +
      "[v](vscode:extension/esbenp.prettier-vscode)\n" +
      "[z](zotero://select/items/123)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("ignores protocol-relative //host/ URLs", async () => {
    existsMock.mockResolvedValue(false);
    const md =
      "[cdn](//cdn.example.com/lib.js)\n![i](//img.example.com/a.png)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("still checks Windows drive-letter paths as file paths", async () => {
    // "C:/…" matches the RFC-3986 scheme shape but is a path, not a URI.
    existsMock.mockResolvedValue(false);
    const md = "[w](C:/docs/file.md)\n";
    const diags = await checkLocalLinks(md, "/repo/docs/index.md");
    expect(existsMock).toHaveBeenCalled();
    expect(diags.length).toBe(1);
  });

  it("strips fragment from link before checking", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[s](./other.md#section)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    expect(existsMock).toHaveBeenCalledWith("/repo/docs/other.md");
  });

  it("resolves relative paths against the source file's directory", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[s](../sibling.md)\n";
    await checkLocalLinks(md, "/repo/docs/sub/index.md");
    expect(existsMock).toHaveBeenCalledWith("/repo/docs/sibling.md");
  });

  it("checks a /-rooted URL as the filesystem-absolute path it names (#1448)", async () => {
    // The image renderer already loads `/`-rooted sources as absolute paths;
    // the checker must look at the same file, not `<doc dir>/docs/intro.md`.
    existsMock.mockResolvedValue(true);
    const md = "[s](/docs/intro.md)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    expect(existsMock).toHaveBeenCalledWith("/docs/intro.md");
  });

  it("resolves relative links against a Windows source path with its drive intact (#1448)", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[s](A.md)\n";
    await checkLocalLinks(md, "C:\\Users\\p\\notes\\B.md");
    expect(existsMock).toHaveBeenCalledWith("C:/Users/p/notes/A.md");
  });

  it("dedupes repeated link targets — fs.exists called once per unique path", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[a](./x.md)\n[b](./x.md)\n[c](./x.md)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    // Should be called exactly once for x.md.
    expect(existsMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty when filePath is null (untitled document)", async () => {
    const md = "[link](./target.md)\n";
    const diags = await checkLocalLinks(md, null);
    expect(diags).toEqual([]);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("does not crash on unparseable markdown", async () => {
    const md = "this is not valid syntax \\\\";
    await expect(
      checkLocalLinks(md, "/repo/docs/index.md"),
    ).resolves.toEqual([]);
  });

  it("percent-decodes image targets so %20 paths match the renderer", async () => {
    // The media pipeline (resolveMediaSrc) decodes %20 before hitting the
    // filesystem — the link check must agree or a rendering image lints
    // as M001 "not found".
    existsMock.mockResolvedValue(true);
    const md = "![x](photo%20one.png)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    expect(existsMock).toHaveBeenCalledWith("/repo/docs/photo one.png");
  });

  it("percent-decodes link targets before resolution", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[a](my%20file.md#sec)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    expect(existsMock).toHaveBeenCalledWith("/repo/docs/my file.md");
  });

  it("falls back to the raw path on malformed % sequences (no throw)", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[a](bad%zz.md)\n";
    await expect(
      checkLocalLinks(md, "/repo/docs/index.md"),
    ).resolves.toEqual([]);
    expect(existsMock).toHaveBeenCalledWith("/repo/docs/bad%zz.md");
  });
});

describe("isExternalUrl — scheme vs Windows drive-letter distinction", () => {
  it("treats any RFC-3986 scheme as external", () => {
    expect(isExternalUrl("obsidian://open?vault=v")).toBe(true);
    expect(isExternalUrl("vscode:extension/x")).toBe(true);
    expect(isExternalUrl("mailto:a@b.c")).toBe(true);
    expect(isExternalUrl("my+scheme.x-1:path")).toBe(true);
  });

  it("treats protocol-relative URLs as external", () => {
    expect(isExternalUrl("//host/path.png")).toBe(true);
  });

  it("keeps Windows drive-letter paths internal (checked as paths)", () => {
    expect(isExternalUrl("C:\\docs\\file.md")).toBe(false);
    expect(isExternalUrl("C:/docs/file.md")).toBe(false);
    expect(isExternalUrl("c:/x")).toBe(false);
  });

  it("does not treat local paths as external", () => {
    expect(isExternalUrl("./a.md")).toBe(false);
    expect(isExternalUrl("dir/a.md")).toBe(false);
    expect(isExternalUrl("/rooted/a.md")).toBe(false);
  });
});

describe("resolveMarkdownUrl — percent-decoding", () => {
  it("decodes %20 in the path part", () => {
    expect(resolveMarkdownUrl("my%20file.md", "/repo/docs/index.md")).toBe(
      "/repo/docs/my file.md",
    );
  });

  it("strips the fragment before decoding the path part", () => {
    expect(
      resolveMarkdownUrl("./other%20doc.md#sec", "/repo/docs/index.md"),
    ).toBe("/repo/docs/other doc.md");
  });

  it("does not throw on malformed % sequences and keeps the raw path", () => {
    expect(resolveMarkdownUrl("bad%zz.md", "/repo/docs/index.md")).toBe(
      "/repo/docs/bad%zz.md",
    );
  });
});

// #1448 — absolute links were base-prefixed onto the document's directory, and
// Windows sources lost their drive (`/C:/…`), so neither opened.
describe("resolveMarkdownUrl — absolute and cross-platform paths", () => {
  it.each([
    // [href, sourcePath, expected]
    ["/Users/me/Documents/记事本/A.md", "/Users/me/Documents/记事本/B.md", "/Users/me/Documents/记事本/A.md"],
    ["/Users/p/%E8%AE%B0%E4%BA%8B.md", "/Users/p/notes/B.md", "/Users/p/记事.md"],
    ["/a/../b/./c.md", "/repo/x.md", "/b/c.md"],
    ["A.md", "C:\\Users\\p\\notes\\B.md", "C:/Users/p/notes/A.md"],
    ["..\\A.md", "C:\\Users\\p\\notes\\B.md", "C:/Users/p/A.md"],
    ["../../../../../x.md", "C:/a/b.md", "C:/x.md"],
    ["D:\\x\\y.md", "/repo/docs/index.md", "D:/x/y.md"],
    ["C:/a/../b.md", "/repo/docs/index.md", "C:/b.md"],
    ["/x/y.md", "D:\\notes\\a.md", "D:/x/y.md"],
    ["b.md", "\\\\server\\share\\docs\\a.md", "//server/share/docs/b.md"],
    ["../../../b.md", "\\\\server\\share\\docs\\a.md", "//server/share/b.md"],
    ["../../../../x.md", "/a/b.md", "/x.md"],
  ])("%s from %s → %s", (href, source, expected) => {
    expect(resolveMarkdownUrl(href, source)).toBe(expected);
  });

  it("resolves absolute paths without a source document", () => {
    expect(resolveMarkdownUrl("/abs/%E8%AE%B0.md#h", null)).toBe("/abs/记.md");
    expect(resolveMarkdownUrl("C:\\x\\y.md", null)).toBe("C:/x/y.md");
  });

  // A UNC or protocol-relative href names a NETWORK host. Opening one on
  // Windows reaches out over SMB, which can hand the user's NTLM credentials to
  // whoever the document names — so a link may never pick the host. (A document
  // that itself lives on a share still resolves relative links, above.)
  it.each([
    "\\\\attacker\\share\\a.md",
    "//attacker/share/a.md",
    "//example.com/docs/A.md",
    "/\\attacker\\share\\a.md",
  ])("refuses the network path %s", (href) => {
    expect(resolveMarkdownUrl(href, "/repo/docs/index.md")).toBe("");
    expect(resolveMarkdownUrl(href, "C:\\notes\\B.md")).toBe("");
    expect(resolveMarkdownUrl(href, null)).toBe("");
  });

  // `C:foo.md` is relative to the process's current directory on drive C —
  // meaningless for a document, so it is refused rather than guessed at.
  it.each(["C:foo.md", "C:", "c:..\\x.md"])("refuses the drive-relative path %s", (href) => {
    expect(resolveMarkdownUrl(href, "C:/notes/B.md")).toBe("");
  });

  it("returns empty for a relative path without a source document", () => {
    expect(resolveMarkdownUrl("./a.md", null)).toBe("");
  });

  it("returns empty for a fragment-only or empty URL", () => {
    expect(resolveMarkdownUrl("#h", "/repo/a.md")).toBe("");
    expect(resolveMarkdownUrl("", "/repo/a.md")).toBe("");
  });
});
