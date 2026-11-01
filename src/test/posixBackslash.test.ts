// @vitest-environment node
// One rule across every path surface: on macOS and Linux a backslash in a POSIX
// absolute path is part of a name, and `/notes/a\b.md` is not `/notes/a/b.md`.
// On Windows a backslash is a separator, and nothing about these paths changes.
//
// The table runs each surface under both readings, because the danger is on
// both sides: conflating the two files overwrites one with the other on macOS,
// and preserving the backslash on Windows would let `C:\ws\..\x` past a check.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

import { resolveMarkdownUrl } from "@/lib/markdownLinkCheck/check";
import { resolveLocalUsesRef } from "@/lib/ghaWorkflow/paths";
import { formatLookupKeys } from "@/lib/formats/formatPathKeys";
import { normalizePathForAsset } from "@/plugins/shared/resolveMediaPath";
import { exportFolderPath } from "@/export/exportToHtmlFolder";
import { isInsideBase } from "@/export/resourcePaths";
import { resolveWorkspacePath } from "@/services/breakdown/breakdownShared";
import { deckExportDefaultPath } from "@/services/contentServer/slidevDeck";
import { resolveBridgePathDecision } from "@/utils/mcpBridgePathPolicy";
import { backslashIsNameCharacter, toForwardSlashes, withoutTrailingSeparators } from "@/utils/pathUtils";
import { fileIdentityKey, isSameFile } from "@/utils/paths/fileIdentity";
import { canonicalPathKey, isWithinRootForCompare, pathsEqualForCompare } from "@/utils/paths/pathComparison";
import { getFileName, getParentDir, getRelativePath, isPathExcluded, isWithinRoot, normalizePath } from "@/utils/paths/paths";

function setPlatform(value: string): void {
  Object.defineProperty(navigator, "platform", { value, configurable: true, writable: true });
}

afterEach(() => setPlatform("MacIntel"));

describe("backslashIsNameCharacter", () => {
  it.each([
    ["/notes/a\\b.md", "macos", true],
    ["/notes/a\\b.md", "linux", true],
    ["///notes/a\\b.md", "macos", true],
    ["/notes/a\\b.md", "windows", false],
    ["//server/share\\a.md", "macos", false],
    ["\\\\server\\share\\a.md", "macos", false],
    ["/\\attacker\\share\\a.md", "macos", false],
    ["C:\\notes\\a.md", "macos", false],
    ["assets\\a.png", "macos", false],
    ["", "macos", false],
  ] as const)("%s on %s → %s", (path, platform, expected) => {
    expect(backslashIsNameCharacter(path, platform)).toBe(expected);
  });

  it("reads the running platform when none is given", () => {
    expect(backslashIsNameCharacter("/a\\b.md")).toBe(true);
    setPlatform("Win32");
    expect(backslashIsNameCharacter("/a\\b.md")).toBe(false);
  });
});

describe("on macOS and Linux", () => {
  describe.each(["MacIntel", "Linux x86_64"])("navigator.platform %s", (value) => {
    beforeEach(() => setPlatform(value));

    it("keeps the name whole in the shared helpers", () => {
      expect(toForwardSlashes("/notes/a\\b.md")).toBe("/notes/a\\b.md");
      expect(normalizePath("/notes/a\\b/")).toBe("/notes/a\\b");
      expect(getFileName("/notes/a\\b.md")).toBe("a\\b.md");
      expect(getParentDir("/notes/a\\b.md")).toBe("/notes");
      expect(getParentDir("/notes/a\\b/c.md")).toBe("/notes/a\\b");
      expect(getRelativePath("/notes", "/notes/a\\b/c.md")).toBe("a\\b/c.md");
    });

    it("does not exclude a folder that only contains an excluded name", () => {
      expect(isPathExcluded("/ws/node_modules\\x/a.md", "/ws", ["node_modules"])).toBe(false);
      expect(isPathExcluded("/ws/node_modules/a.md", "/ws", ["node_modules"])).toBe(true);
    });

    it("still treats non-POSIX shapes as separated", () => {
      expect(normalizePath("C:\\Users\\a.md")).toBe("c:/Users/a.md");
      expect(normalizePath("\\\\server\\share\\a.md")).toBe("//server/share/a.md");
      expect(normalizePath("assets\\a.png")).toBe("assets/a.png");
    });

    it("keeps a sibling whose name starts with the root's outside that root", () => {
      expect(isWithinRoot("/ws", "/ws\\evil.md")).toBe(false);
      expect(isWithinRoot("/notes/a\\b", "/notes/a/b/c.md")).toBe(false);
      expect(isWithinRoot("/notes/a\\b", "/notes/a\\b/c.md")).toBe(true);
    });
  });

  it("gives two distinct files two identities", () => {
    for (const platform of ["macos", "linux"] as const) {
      expect(isSameFile("/notes/a\\b.md", "/notes/a/b.md", platform)).toBe(false);
      expect(pathsEqualForCompare("/notes/a\\b.md", "/notes/a/b.md", platform)).toBe(false);
      expect(isWithinRootForCompare("/notes/a", "/notes/a\\b.md", platform)).toBe(false);
      expect(fileIdentityKey("/notes/./a\\b.md", platform)).toBe("/notes/a\\b.md");
    }
    expect(canonicalPathKey("/notes/x/../a\\b.md")).toBe("/notes/a\\b.md");
  });

  it("does not read a backslashed dot-dot as a traversal in the identity", () => {
    expect(canonicalPathKey("/notes/x\\..\\y.md")).toBe("/notes/x\\..\\y.md");
  });

  it("loads the media file that is named, not its look-alike", () => {
    expect(normalizePathForAsset("/photos/a\\b.png")).toBe("/photos/a\\b.png");
    expect(normalizePathForAsset("C:\\photos\\b.png")).toBe("C:/photos/b.png");
  });

  it("resolves a markdown link to the file it names", () => {
    expect(resolveMarkdownUrl("/notes/a%5Cb.md", "/repo/index.md")).toBe("/notes/a\\b.md");
    expect(resolveMarkdownUrl("c.md", "/notes/a\\b/index.md")).toBe("/notes/a\\b/c.md");
    expect(resolveMarkdownUrl("sub\\c.md", "/notes/index.md")).toBe("/notes/sub/c.md");
  });

  it("keeps refusing every spelling of a network path in a markdown link", () => {
    for (const href of ["/\\attacker\\share\\a.md", "/%5Cattacker%5Cshare%5Ca.md", "\\\\attacker\\share\\a.md"]) {
      expect(resolveMarkdownUrl(href, "/repo/index.md")).toBe("");
    }
  });

  it("anchors a workflow's local action at a workspace root holding a backslash", () => {
    const resolved = resolveLocalUsesRef("./.github/actions/setup", "/repo\\x/.github/workflows/ci.yml", "/repo\\x");
    expect(resolved).toEqual({ kind: "action", absPath: "/repo\\x/.github/actions/setup/action.yml" });
  });

  it("derives names and extensions from the real last segment", () => {
    expect(formatLookupKeys("/x/a.md\\b")).toContain("a.md\\b");
    expect(exportFolderPath("/out/a\\.html")).toBe("/out/a\\");
    expect(deckExportDefaultPath("/decks/a.b\\c")).toBe("/decks/a.pdf");
  });
});

describe("a root that ends in, or is followed by, a backslash", () => {
  it("strips only real separators", () => {
    expect(withoutTrailingSeparators("/repo\\")).toBe("/repo\\");
    expect(withoutTrailingSeparators("/repo\\/")).toBe("/repo\\");
    expect(withoutTrailingSeparators("/repo//")).toBe("/repo");
    expect(withoutTrailingSeparators("C:\\repo\\")).toBe("C:\\repo");
    expect(withoutTrailingSeparators("/repo\\", "windows")).toBe("/repo");
  });

  it("keeps image export's containment to the real folder (macOS)", () => {
    expect(isInsideBase("/vault/secret.png", "/vault\\")).toBe(false);
    expect(isInsideBase("/vault\\/a.png", "/vault\\")).toBe(true);
    expect(isInsideBase("/vault\\sibling.png", "/vault")).toBe(false);
    expect(isInsideBase("/vault/a.png", "/vault/")).toBe(true);
    expect(isInsideBase("/any/a.png", "//")).toBe(true);
  });

  it("keeps image export's containment unchanged on Windows", () => {
    setPlatform("Win32");
    expect(isInsideBase("D:\\a\\b.png", "D:\\a\\")).toBe(true);
    expect(isInsideBase("/vault\\a.png", "/vault")).toBe(true);
  });

  it("opens the artifact inside the real workspace", () => {
    expect(resolveWorkspacePath("/repo\\", "docs/a.md")).toBe("/repo\\/docs/a.md");
    expect(resolveWorkspacePath("/repo/", "docs/a.md")).toBe("/repo/docs/a.md");
    setPlatform("Win32");
    expect(resolveWorkspacePath("C:\\repo\\", "docs/a.md")).toBe("C:\\repo/docs/a.md");
  });
});

describe("the MCP bridge boundary", () => {
  const roots = { allowedRoots: ["/ws"] };

  it("refuses a sibling whose name merely starts with the root (macOS)", () => {
    expect(resolveBridgePathDecision("/ws\\evil.md", roots)).toMatchObject({ allowed: false });
  });

  it("allows a backslashed name inside the root (macOS)", () => {
    expect(resolveBridgePathDecision("/ws/a\\b.md", roots)).toEqual({ allowed: true });
  });

  it("scopes a backslashed document's grant to its real folder", () => {
    const allowedRoots = [getParentDir("/ws/a\\b.md")];
    expect(allowedRoots).toEqual(["/ws"]);
    expect(resolveBridgePathDecision("/elsewhere/a.md", { allowedRoots })).toMatchObject({ allowed: false });
  });

  it.each(["/ws/..\\..\\secret.md", "/ws/x\\..\\y.md"])("keeps refusing a backslashed dot-dot on macOS: %s", (path) => {
    expect(resolveBridgePathDecision(path, roots)).toMatchObject({ allowed: false });
  });

  it("is unchanged on Windows", () => {
    setPlatform("Win32");
    const winRoots = { allowedRoots: ["C:\\ws"] };
    expect(resolveBridgePathDecision("C:\\ws\\notes\\x.md", winRoots)).toEqual({ allowed: true });
    expect(resolveBridgePathDecision("C:\\ws\\..\\secret.md", winRoots)).toMatchObject({ allowed: false });
    expect(resolveBridgePathDecision("/ws\\..\\secret.md", roots)).toMatchObject({ allowed: false });
    expect(resolveBridgePathDecision("/ws\\evil.md", roots)).toEqual({ allowed: true });
  });
});

describe("on Windows, a backslash stays a separator", () => {
  beforeEach(() => setPlatform("Win32"));

  it.each([
    ["/notes/a\\b.md", "/notes/a/b.md"],
    ["C:\\notes\\a.md", "c:/notes/a.md"],
    ["\\\\server\\share\\a.md", "//server/share/a.md"],
  ])("normalizePath(%s) → %s", (input, expected) => {
    expect(normalizePath(input)).toBe(expected);
  });

  it("treats one file's two spellings as one identity", () => {
    expect(isSameFile("/notes/a\\b.md", "/notes/a/b.md", "windows")).toBe(true);
    expect(isSameFile("C:\\notes\\A.md", "c:/notes/a.md", "windows")).toBe(true);
  });

  it("splits names, parents and media paths on the backslash", () => {
    expect(getFileName("/notes/a\\b.md")).toBe("b.md");
    expect(getParentDir("/notes/a\\b.md")).toBe("/notes/a");
    expect(normalizePathForAsset("/photos/a\\b.png")).toBe("/photos/a/b.png");
    expect(resolveMarkdownUrl("/notes/a%5Cb.md", "C:\\repo\\index.md")).toBe("C:/notes/a/b.md");
  });

  it("honours an explicit platform over the running one", () => {
    setPlatform("MacIntel");
    expect(fileIdentityKey("/a\\b.md", "windows")).toBe("/a/b.md");
    expect(pathsEqualForCompare("/a\\b.md", "/a/b.md", "windows")).toBe(true);
    setPlatform("Win32");
    expect(fileIdentityKey("/a\\b.md", "macos")).toBe("/a\\b.md");
  });
});
