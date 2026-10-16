// @vitest-environment node
// WI-RA9A.8 — the single media-source resolver behind all three callers.
import { describe, expect, it, vi } from "vitest";
import { ADVERSARIAL_MEDIA_SOURCES } from "@/test/adversarialMediaSources";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

import {
  normalizePathForAsset,
  resolveMediaPath,
  snapshotActiveFilePath,
  type MediaPathContext,
} from "./resolveMediaPath";
import { bindHostDocument, resetHostDocument } from "./hostDocument";

function context(overrides: Partial<MediaPathContext> = {}) {
  return {
    documentPath: vi.fn<MediaPathContext["documentPath"]>(() => "/docs/notes/report.md"),
    unresolvablePath: "passthrough" as MediaPathContext["unresolvablePath"],
    onRefused: vi.fn<MediaPathContext["onRefused"]>(),
    onError: vi.fn<MediaPathContext["onError"]>(),
    ...overrides,
  };
}

const VERDICTS = ["passthrough", "refuse"] as const;

describe("normalizePathForAsset", () => {
  it.each([
    ["C:\\Users\\test\\image.png", "C:/Users/test/image.png"],
    ["C:\\Users/test\\file.mp3", "C:/Users/test/file.mp3"],
    ["/Users/docs/文档 示例.assets/photo.jpg", "/Users/docs/文档 示例.assets/photo.jpg"],
    ["", ""],
  ])("%s -> %s, without percent-encoding", (input, expected) => {
    expect(normalizePathForAsset(input)).toBe(expected);
  });
});

describe.each(VERDICTS)("resolveMediaPath (unresolvablePath: %s)", (unresolvablePath) => {
  it.each([
    ["an https URL, escapes intact", "https://example.com/a%20b.png", "https://example.com/a%20b.png"],
    ["a data URL", "data:image/png;base64,AAAA", "data:image/png;base64,AAAA"],
    ["an asset URL", "asset://localhost/x.png", "asset://localhost/x.png"],
    ["a bracketed external URL", "<https://example.com/a b.png>", "https://example.com/a b.png"],
    ["an absolute path", "/pics/a.png", "asset:///pics/a.png"],
    ["an absolute path with escapes", "/my%20pics/a.png", "asset:///my pics/a.png"],
    ["a Windows path", "C:\\pics\\a.png", "asset://C:/pics/a.png"],
    ["a relative path", "img/图.png", "asset:///docs/notes/img/图.png"],
    ["a ./ relative path", "./a.png", "asset:///docs/notes/a.png"],
    ["a parent-relative path", "../images/a.png", "asset:///docs/images/a.png"],
  ])("resolves %s", async (_label, src, expected) => {
    const ctx = context({ unresolvablePath });
    expect(await resolveMediaPath(src, ctx)).toBe(expected);
    expect(ctx.onRefused).not.toHaveBeenCalled();
    expect(ctx.onError).not.toHaveBeenCalled();
  });

  it("does not ask for the document unless the path is relative", async () => {
    const ctx = context({ unresolvablePath });
    await resolveMediaPath("https://example.com/a.png", ctx);
    await resolveMediaPath("/pics/a.png", ctx);
    await resolveMediaPath("javascript:alert(1)", ctx);
    expect(ctx.documentPath).not.toHaveBeenCalled();
  });

  it.each(ADVERSARIAL_MEDIA_SOURCES)("refuses %s and reports it", async (_label, src) => {
    const ctx = context({ unresolvablePath });
    expect(await resolveMediaPath(src, ctx)).toBe("");
    expect(ctx.onRefused).toHaveBeenCalledTimes(1);
  });

  it("returns a relative path unchanged when there is no document", async () => {
    const ctx = context({ unresolvablePath, documentPath: vi.fn(() => null) });
    expect(await resolveMediaPath("my%20pics/a.png", ctx)).toBe("my%20pics/a.png");
    expect(ctx.onRefused).not.toHaveBeenCalled();
  });

  it("returns a relative path unchanged, and reports, when the document lookup throws", async () => {
    const failure = new Error("no window");
    const ctx = context({
      unresolvablePath,
      documentPath: vi.fn(() => {
        throw failure;
      }),
    });
    expect(await resolveMediaPath("a.png", ctx)).toBe("a.png");
    expect(ctx.onError).toHaveBeenCalledWith(failure);
  });
});

describe("resolveMediaPath — a path that is not a resolvable media file", () => {
  const UNRESOLVABLE = [
    ["an empty string", ""],
    ["whitespace", "   "],
    ["a directory", "assets/"],
    ["the parent directory", "../"],
    ["a bare ..", ".."],
    ["a home-relative path", "~/pics/a.png"],
  ] as const;

  it.each(UNRESOLVABLE)("passthrough hands back %s unchanged, silently", async (_label, src) => {
    const ctx = context({ unresolvablePath: "passthrough" });
    expect(await resolveMediaPath(src, ctx)).toBe(src);
    expect(ctx.onRefused).not.toHaveBeenCalled();
    expect(ctx.documentPath).not.toHaveBeenCalled();
  });

  it.each(UNRESOLVABLE)("refuse returns the empty string for %s and reports it", async (_label, src) => {
    const ctx = context({ unresolvablePath: "refuse" });
    expect(await resolveMediaPath(src, ctx)).toBe("");
    expect(ctx.onRefused).toHaveBeenCalledTimes(1);
    expect(ctx.documentPath).not.toHaveBeenCalled();
  });
});

describe("snapshotActiveFilePath", () => {
  it("keeps the path read when taken, though the active document changes after", () => {
    let active = "/A/doc.md";
    bindHostDocument({ currentWindowLabel: () => "main", activeFilePath: () => active });
    try {
      const documentPath = snapshotActiveFilePath();
      active = "/B/doc.md";
      expect(documentPath()).toBe("/A/doc.md");
    } finally {
      resetHostDocument();
    }
  });

  it("replays a failed read when called, so a deferred resolution reports it as onError", async () => {
    const failure = new Error("host binding failed");
    bindHostDocument({ currentWindowLabel: () => "main", activeFilePath: () => { throw failure; } });
    try {
      const documentPath = snapshotActiveFilePath();
      expect(documentPath).toThrow(failure);
      const ctx = context({ documentPath });
      expect(await resolveMediaPath("images/a.png", ctx)).toBe("images/a.png");
      expect(ctx.onError).toHaveBeenCalledWith(failure);
    } finally {
      resetHostDocument();
    }
  });
});
