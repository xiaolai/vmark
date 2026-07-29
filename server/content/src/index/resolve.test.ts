// M13 — direct tests for wiki-link resolution (§3bis spec branches).
import { describe, it, expect } from "vitest";
import { WikiResolver } from "./resolve";
import type { DocEntry } from "./types";

function doc(relPath: string): DocEntry {
  const base = relPath.slice(relPath.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return { absPath: "/ws/" + relPath, relPath, basename: base.normalize("NFC") };
}

describe("WikiResolver", () => {
  it("resolves a bare basename anywhere in the workspace", () => {
    const r = new WikiResolver([doc("notes/Page.md")]);
    expect(r.resolve("Page", "Home.md").relPath).toBe("notes/Page.md");
  });

  it("resolves a path-bearing target by relpath", () => {
    const r = new WikiResolver([doc("a/b/Deep.md"), doc("Deep.md")]);
    expect(r.resolve("a/b/Deep", "Home.md").relPath).toBe("a/b/Deep.md");
  });

  it("honors an explicit .md extension as an exact relpath match", () => {
    const r = new WikiResolver([doc("dir/Note.md")]);
    expect(r.resolve("dir/Note.md", "Home.md").relPath).toBe("dir/Note.md");
    expect(r.resolve("Nope.md", "Home.md").relPath).toBeNull();
  });

  it("splits the #anchor and resolves the file part", () => {
    const r = new WikiResolver([doc("Page.md")]);
    const res = r.resolve("Page#Section Two", "x.md");
    expect(res.relPath).toBe("Page.md");
    expect(res.anchor).toBe("Section Two");
  });

  it("dup basenames: same-dir wins, else shortest path", () => {
    const r = new WikiResolver([doc("deep/x/Dup.md"), doc("Dup.md"), doc("b/Dup.md")]);
    expect(r.resolve("Dup", "b/Src.md").relPath).toBe("b/Dup.md"); // same dir
    expect(r.resolve("Dup", "other/Src.md").relPath).toBe("Dup.md"); // shortest
  });

  it("returns null for empty / anchor-only targets", () => {
    const r = new WikiResolver([doc("Page.md")]);
    expect(r.resolve("", "x.md").relPath).toBeNull();
    expect(r.resolve("#frag", "x.md").relPath).toBeNull();
  });

  it("matches case-insensitively", () => {
    const r = new WikiResolver([doc("MixedCase.md")]);
    expect(r.resolve("mixedcase", "x.md").relPath).toBe("MixedCase.md");
  });
});
