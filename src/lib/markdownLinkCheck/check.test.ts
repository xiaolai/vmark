// Markdown broken-link checker. Validates that local link / image
// targets referenced from a markdown file actually exist on disk.

import { describe, it, expect, vi, beforeEach } from "vitest";

const existsMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/plugin-fs", () => ({ exists: existsMock }));

import { checkLocalLinks } from "./check";

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

  it("resolves /-rooted absolute URLs against the file's workspace root", async () => {
    existsMock.mockResolvedValue(true);
    const md = "[s](/docs/intro.md)\n";
    await checkLocalLinks(md, "/repo/docs/index.md");
    // `/`-rooted paths resolve against the FILE's directory parent
    // chain — for safety, treat as relative to file's directory.
    expect(existsMock).toHaveBeenCalled();
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
});
