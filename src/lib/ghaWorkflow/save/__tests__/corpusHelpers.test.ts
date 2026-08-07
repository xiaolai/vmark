// @vitest-environment node
// Tests for the shared workflow-corpus test helpers.
//
// `anchorUsage` exists because the regex it replaces (`&[\w-]+`) did not
// identify YAML anchors at all — these cases pin both directions.
import { describe, expect, it } from "vitest";
import { walkWorkflows, toPosix, commentSet, anchorUsage } from "@/test/ghaCorpusHelpers";

describe("toPosix", () => {
  it("leaves a posix path unchanged", () => {
    expect(toPosix("a/b/c.yml")).toBe("a/b/c.yml");
  });
});

describe("walkWorkflows", () => {
  it("finds workflow files and returns forward-slash paths", () => {
    const files = walkWorkflows(".github/workflows");
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.includes("/"))).toBe(true);
    expect(files.every((f) => !f.includes("\\"))).toBe(true);
    expect(files.every((f) => f.endsWith(".yml") || f.endsWith(".yaml"))).toBe(true);
  });
});

describe("commentSet", () => {
  it("collects line and inline comments", () => {
    expect(commentSet("# top\nkey: value # trailing\n")).toEqual(
      new Set(["top", "trailing"]),
    );
  });

  it("ignores a # inside a quoted scalar", () => {
    expect(commentSet('key: "not # a comment"\n')).toEqual(new Set());
  });
});

describe("anchorUsage", () => {
  it("reports declared anchors and the anchors aliases point at", () => {
    const yaml = "defaults: &base\n  run: echo\njob: *base\n";
    expect(anchorUsage(yaml)).toEqual({ anchors: ["base"], aliases: ["base"] });
  });

  it("does NOT count a shell redirect as an anchor", () => {
    // The regex this replaces matched `&1` in `2>&1`.
    expect(anchorUsage("steps:\n  - run: cmd 2>&1\n").anchors).toEqual([]);
  });

  it("does NOT count an HTML entity as an anchor", () => {
    expect(anchorUsage('name: "Build &amp; Test"\n').anchors).toEqual([]);
  });

  it("sees a renamed anchor, which an equal count would hide", () => {
    const before = anchorUsage("a: &one\n  x: 1\nb: *one\n");
    const after = anchorUsage("a: &two\n  x: 1\nb: *two\n");
    expect(before).not.toEqual(after);
  });

  it("returns empty lists for a document with no anchors", () => {
    expect(anchorUsage("name: plain\non: push\n")).toEqual({ anchors: [], aliases: [] });
  });
});
