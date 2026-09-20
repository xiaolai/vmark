/**
 * Tests for export resource PATHS — resolution base, containment root, and
 * the `src` → absolute-path conversion.
 *
 * Split from `resourceResolver.test.ts` alongside the module split: these
 * cover where an exported image may come FROM, while that file covers how the
 * bytes are bundled once a path is settled.
 *
 * @coordinates-with export/resourcePaths.ts
 * @module export/resourcePaths.test
 */

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn((...parts: string[]) => Promise.resolve(parts.join("/"))),
  dirname: vi.fn((path: string) =>
    Promise.resolve(path.split("/").slice(0, -1).join("/") || "/"),
  ),
  basename: vi.fn((path: string) =>
    Promise.resolve(path.split("/").pop() || ""),
  ),
  normalize: vi.fn((path: string) => {
    // Tauri-like normalization: resolves "." and ".." but PRESERVES leading
    // "//" (POSIX allows implementation-defined meaning for paths starting
    // with exactly two slashes; Tauri does not collapse them). Also respects
    // paths without any leading slash (e.g. Windows "C:/..." drive paths).
    const leadingSlashes = path.match(/^\/+/)?.[0] ?? "";
    const rest = path.slice(leadingSlashes.length);
    const parts = rest.split("/");
    const normalized: string[] = [];
    for (const part of parts) {
      if (part === "..") {
        normalized.pop();
      } else if (part !== "." && part !== "") {
        normalized.push(part);
      }
    }
    // Preserve leading slashes as-is (none / single / double), collapse 3+ to //
    const prefix =
      leadingSlashes.length === 0
        ? ""
        : leadingSlashes.length >= 2
          ? "//"
          : "/";
    return Promise.resolve(prefix + normalized.join("/"));
  }),
}));

vi.mock("@/utils/debug", () => ({
  exportWarn: vi.fn(),
}));

import {
  isAssetUrl,
  isInsideBase,
  resolveRelativePath,
  getDocumentBaseDir,
  getExportContainmentRoot,
} from "./resourcePaths";

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// isAssetUrl
// ---------------------------------------------------------------------------
describe("isAssetUrl", () => {
  it("returns true for asset:// protocol", () => {
    expect(isAssetUrl("asset://localhost/path/to/file.png")).toBe(true);
  });

  it("returns true for tauri:// protocol", () => {
    expect(isAssetUrl("tauri://some-resource")).toBe(true);
  });

  it("returns true for https://asset.localhost/", () => {
    expect(isAssetUrl("https://asset.localhost/path/to/file.png")).toBe(true);
  });

  it("returns true for http://asset.localhost/ (Windows/WebView2 scheme)", () => {
    expect(isAssetUrl("http://asset.localhost/path/to/file.png")).toBe(true);
  });

  it("returns false for regular https URLs", () => {
    expect(isAssetUrl("https://example.com/image.png")).toBe(false);
  });

  it("returns false for regular http URLs", () => {
    expect(isAssetUrl("http://example.com/image.png")).toBe(false);
  });

  it("returns false for relative paths", () => {
    expect(isAssetUrl("images/photo.png")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAssetUrl("")).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// isInsideBase — direct unit tests for the helper, including the Windows
// separator branch that is unreachable via the POSIX-only normalize() mock.
// ---------------------------------------------------------------------------
describe("isInsideBase", () => {
  it("returns true when path equals base (===  branch)", () => {
    expect(isInsideBase("/a/b", "/a/b")).toBe(true);
  });

  it("returns true when path is inside base via POSIX separator", () => {
    expect(isInsideBase("/a/b/x.png", "/a/b")).toBe(true);
  });

  it("returns true when path is inside base via Windows separator", () => {
    expect(isInsideBase("C:\\a\\b\\x.png", "C:\\a\\b")).toBe(true);
  });

  it("returns false for sibling directory whose name shares the base prefix", () => {
    expect(isInsideBase("/a/b-evil/x.png", "/a/b")).toBe(false);
    expect(isInsideBase("C:\\a\\b-evil\\x.png", "C:\\a\\b")).toBe(false);
  });

  it("returns false for completely unrelated paths", () => {
    expect(isInsideBase("/c/d", "/a/b")).toBe(false);
  });
});


// ---------------------------------------------------------------------------
// resolveRelativePath
// ---------------------------------------------------------------------------
describe("resolveRelativePath", () => {
  it("blocks absolute paths outside baseDir", async () => {
    const result = await resolveRelativePath("/etc/passwd", "/Users/test/docs");
    expect(result).toBeNull();
  });

  it("allows absolute paths within baseDir", async () => {
    const result = await resolveRelativePath(
      "/Users/test/docs/images/photo.png",
      "/Users/test/docs",
    );
    expect(result).toBe("/Users/test/docs/images/photo.png");
  });

  it("resolves relative paths against base directory", async () => {
    const result = await resolveRelativePath(
      "images/photo.png",
      "/Users/test/docs",
    );
    expect(result).toBe("/Users/test/docs/images/photo.png");
  });

  it("allows asset:// URLs within baseDir", async () => {
    const src = `asset://localhost/${encodeURIComponent("/Users/test/docs/file.png")}`;
    const result = await resolveRelativePath(src, "/Users/test/docs");
    expect(result).toBe("/Users/test/docs/file.png");
  });

  it("blocks asset:// URLs outside baseDir", async () => {
    const src = `asset://localhost/${encodeURIComponent("/etc/passwd")}`;
    const result = await resolveRelativePath(src, "/Users/test/docs");
    expect(result).toBeNull();
  });

  it("allows https://asset.localhost/ URLs within baseDir", async () => {
    const src = `https://asset.localhost/${encodeURIComponent("/Users/test/docs/file.png")}`;
    const result = await resolveRelativePath(src, "/Users/test/docs");
    expect(result).toBe("/Users/test/docs/file.png");
  });

  it("blocks https://asset.localhost/ URLs outside baseDir", async () => {
    const src = `https://asset.localhost/${encodeURIComponent("/etc/shadow")}`;
    const result = await resolveRelativePath(src, "/Users/test/docs");
    expect(result).toBeNull();
  });

  it("decodes URI-encoded characters in asset URLs", async () => {
    // Real convertFileSrc() output: asset://localhost/ + encodeURIComponent(absPath).
    // encodeURIComponent encodes the leading "/" as "%2F", so after decoding
    // the URL path has a double-slash at the start. The resolver must collapse
    // it back to a single slash to match baseDir.
    const absPath = "/Users/test/docs/my file.png";
    const src = `asset://localhost/${encodeURIComponent(absPath)}`;
    const result = await resolveRelativePath(src, "/Users/test/docs");
    expect(result).toBe("/Users/test/docs/my file.png");
  });

  it("handles Windows convertFileSrc shape (https://asset.localhost/ with drive letter)", async () => {
    // On Windows, convertFileSrc uses the https://asset.localhost/ scheme
    // and encodes the whole path including the drive letter's ":".
    // No leading-slash artifact exists on Windows, but the resolver must
    // still strip the URL's own structural slash to recover "C:/...".
    const absPath = "C:/Users/test/docs/photo.png";
    const src = `https://asset.localhost/${encodeURIComponent(absPath)}`;
    const result = await resolveRelativePath(src, "C:/Users/test/docs");
    expect(result).toBe("C:/Users/test/docs/photo.png");
  });

  it("blocks tauri:// URLs outside baseDir", async () => {
    const result = await resolveRelativePath(
      "tauri://localhost/resource.png",
      "/Users/test/docs",
    );
    expect(result).toBeNull();
  });

  it("returns src as-is for invalid asset URL parse", async () => {
    // A URL that the URL constructor can parse but has unusual shape
    const result = await resolveRelativePath("simple-file.png", "/base");
    expect(result).toBe("/base/simple-file.png");
  });

  it("blocks path traversal with ..", async () => {
    const result = await resolveRelativePath(
      "../../.ssh/id_rsa",
      "/Users/test/docs",
    );
    // Should return null when traversal escapes baseDir
    expect(result).toBeNull();
  });

  it("blocks path traversal with encoded ..", async () => {
    const result = await resolveRelativePath(
      "..%2F..%2F.ssh/id_rsa",
      "/Users/test/docs",
    );
    expect(result).toBeNull();
  });

  it("allows .. that stays within baseDir", async () => {
    const result = await resolveRelativePath(
      "subdir/../photo.png",
      "/Users/test/docs",
    );
    // subdir/.. resolves back to /Users/test/docs — still within baseDir
    expect(result).toBe("/Users/test/docs/photo.png");
  });

  // ------------------------------------------------------------------
  // Sibling-directory prefix-confusion: /a/b-evil must not match /a/b
  // ------------------------------------------------------------------
  describe("sibling-directory prefix confusion", () => {
    it("absolute branch: blocks sibling directory whose name starts with baseDir", async () => {
      const result = await resolveRelativePath("/a/b-evil/x.png", "/a/b");
      expect(result).toBeNull();
    });

    it("absolute branch: allows file inside baseDir", async () => {
      const result = await resolveRelativePath("/a/b/x.png", "/a/b");
      expect(result).toBe("/a/b/x.png");
    });

    it("absolute branch: allows the baseDir itself", async () => {
      const result = await resolveRelativePath("/a/b", "/a/b");
      expect(result).toBe("/a/b");
    });

    it("relative branch: blocks `../b-evil/x.png` from /a/b", async () => {
      const result = await resolveRelativePath("../b-evil/x.png", "/a/b");
      expect(result).toBeNull();
    });

    it("relative branch: allows file resolved into baseDir", async () => {
      const result = await resolveRelativePath("./x.png", "/a/b");
      expect(result).toBe("/a/b/x.png");
    });

    it("relative branch: allows `.` resolving to baseDir itself", async () => {
      const result = await resolveRelativePath(".", "/a/b");
      expect(result).toBe("/a/b");
    });

    it("asset-URL branch: blocks sibling directory via asset:// scheme", async () => {
      const src = `asset://localhost/${encodeURIComponent("/a/b-evil/x.png")}`;
      const result = await resolveRelativePath(src, "/a/b");
      expect(result).toBeNull();
    });

    it("asset-URL branch: allows file inside baseDir via asset:// scheme", async () => {
      const src = `asset://localhost/${encodeURIComponent("/a/b/x.png")}`;
      const result = await resolveRelativePath(src, "/a/b");
      expect(result).toBe("/a/b/x.png");
    });

    it("asset-URL branch: allows the baseDir itself via asset:// scheme", async () => {
      const src = `asset://localhost/${encodeURIComponent("/a/b")}`;
      const result = await resolveRelativePath(src, "/a/b");
      expect(result).toBe("/a/b");
    });
  });

});


// ---------------------------------------------------------------------------
// getDocumentBaseDir
// ---------------------------------------------------------------------------
describe("getDocumentBaseDir", () => {
  it("returns dirname for a file path", async () => {
    const result = await getDocumentBaseDir("/Users/test/docs/file.md");
    expect(result).toBe("/Users/test/docs");
  });

  it("returns root for null file path", async () => {
    const result = await getDocumentBaseDir(null);
    expect(result).toBe("/");
  });

  // ---------------------------------------------------------------------
  // Workspace widening (#1433). The renderer resolves `../images/photo.png`
  // against the document's directory, so an export confined to that same
  // directory would substitute a placeholder for an image the user can see
  // on screen. The workspace is the boundary that keeps the export honest
  // without lying about what the document contains.
  // ---------------------------------------------------------------------
  it("is unaffected by a workspace — it is a RESOLUTION base, not a boundary", async () => {
    // Guarding the split: re-anchoring relative paths to the workspace root
    // would turn `photo.png` beside the document into a lookup at the top of
    // the workspace. Only the containment root widens.
    const result = await getDocumentBaseDir("/Users/test/project/notes/report.md");
    expect(result).toBe("/Users/test/project/notes");
  });
});

// ---------------------------------------------------------------------------
// getExportContainmentRoot (#1433)
// ---------------------------------------------------------------------------
describe("getExportContainmentRoot", () => {
  it("widens to the workspace root when the document is inside it", async () => {
    const result = await getExportContainmentRoot(
      "/Users/test/project/notes/report.md",
      "/Users/test/project",
    );
    expect(result).toBe("/Users/test/project");
  });

  it("keeps the document directory when no workspace is open", async () => {
    const result = await getExportContainmentRoot(
      "/Users/test/project/notes/report.md",
      null,
    );
    expect(result).toBe("/Users/test/project/notes");
  });

  it("keeps the document directory when the document is OUTSIDE the workspace", async () => {
    // Widening to a root the document does not live under would grant reach
    // the workspace never justified.
    const result = await getExportContainmentRoot(
      "/Users/test/elsewhere/report.md",
      "/Users/test/project",
    );
    expect(result).toBe("/Users/test/elsewhere");
  });

  it("does not widen to a SIBLING workspace by prefix confusion", async () => {
    // `/Users/test/project-evil` must not count as inside `/Users/test/project`.
    const result = await getExportContainmentRoot(
      "/Users/test/project-evil/notes/report.md",
      "/Users/test/project",
    );
    expect(result).toBe("/Users/test/project-evil/notes");
  });

  it("ignores an empty workspace root", async () => {
    const result = await getExportContainmentRoot(
      "/Users/test/project/notes/report.md",
      "",
    );
    expect(result).toBe("/Users/test/project/notes");
  });

  it("returns the unsaved-buffer fallback when there is no file path", async () => {
    expect(await getExportContainmentRoot(null, "/Users/test/project")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// End-to-end: the widened base is what actually unblocks the export (#1433)
// ---------------------------------------------------------------------------
describe("parent-relative images under a workspace root (#1433)", () => {
  const DOC = "/Users/test/project/notes/report.md";
  const ROOT = "/Users/test/project";

  it("embeds `../images/photo.png` from a sibling folder in the workspace", async () => {
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, ROOT);
    // Resolved from the DOCUMENT's folder, contained by the WORKSPACE.
    await expect(
      resolveRelativePath("../images/photo.png", baseDir, containWithin),
    ).resolves.toBe("/Users/test/project/images/photo.png");
  });

  it("still blocks a path that escapes the workspace root", async () => {
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, ROOT);
    await expect(
      resolveRelativePath("../../../.ssh/id_rsa", baseDir, containWithin),
    ).resolves.toBeNull();
  });

  it("still blocks an ABSOLUTE path outside the workspace root", async () => {
    // The half the renderer cannot enforce: absolute paths are contained too.
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, ROOT);
    await expect(
      resolveRelativePath("/Users/test/.ssh/id_rsa", baseDir, containWithin),
    ).resolves.toBeNull();
  });

  it("still blocks an asset:// URL outside the workspace root", async () => {
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, ROOT);
    const assetUrl = `asset://localhost/${encodeURIComponent("/Users/test/.ssh/id_rsa")}`;
    await expect(
      resolveRelativePath(assetUrl, baseDir, containWithin),
    ).resolves.toBeNull();
  });

  it("embeds an asset:// URL that the renderer produced for a `../` image", async () => {
    // This is the real shape: the editor DOM already holds an asset URL, so
    // the containment root is what decides, not the original `../` spelling.
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, ROOT);
    const assetUrl = `asset://localhost/${encodeURIComponent("/Users/test/project/images/photo.png")}`;
    await expect(
      resolveRelativePath(assetUrl, baseDir, containWithin),
    ).resolves.toBe("/Users/test/project/images/photo.png");
  });

  it("without a workspace, a `../` image stays blocked — the document folder is the boundary", async () => {
    const baseDir = await getDocumentBaseDir(DOC);
    const containWithin = await getExportContainmentRoot(DOC, null);
    await expect(
      resolveRelativePath("../images/photo.png", baseDir, containWithin),
    ).resolves.toBeNull();
  });
});

