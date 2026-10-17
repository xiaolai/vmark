// @vitest-environment node
// WI-OC2.2 — both entry points prosemirror-view exports carry VMark's patch.
// The app imports the ES module; anything that `require`s the package gets the
// CommonJS build, and a patch to one file only would leave that path
// quadratic while every test here, which runs the ES module, stayed green.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

/** prosemirror-view as @tiptap/pm resolves it (it is not a direct dependency). */
function packageRoot(): string {
  const fromPm = createRequire(createRequire(import.meta.url).resolve("@tiptap/pm/view"));
  // The CommonJS main is `dist/index.cjs`; the package root is two levels up.
  return path.dirname(path.dirname(fromPm.resolve("prosemirror-view")));
}

/** The patched sites: the shared helper, `buildTree`, `addInner`, `forChild` and its hint. */
const PATCHED_SITES = 15;

describe("the prosemirror-view patch", () => {
  const root = packageRoot();
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
    version: string;
    exports: { ".": { import: string; require: string } };
  };

  it("is for the installed version", () => {
    expect(manifest.version).toBe("1.42.6");
  });

  it.each(["import", "require"] as const)("is in the %s entry point", (condition) => {
    const source = readFileSync(path.join(root, manifest.exports["."][condition]), "utf8");
    expect(source.match(/VMark patch \(#1565\)/g)).toHaveLength(PATCHED_SITES);
    expect(source).toContain("function takeSpansForChildren(");
    expect(source).not.toContain("function takeSpansForNode(");
  });
});
