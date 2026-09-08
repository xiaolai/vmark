// @vitest-environment node
// Path → lookup-key helpers. The keys decide which format opens a file, so the
// shapes below are the contract `registry.dispatchEditor` reads.
//
// `formatExtensionKey` exists because the built-in extension map must NOT be
// consulted with the full-basename keys: an extensionless file named `md` or
// `html` resolved to that format, against the registry's own stated contract
// ("markdown only ever matches via its own registered .md-family extensions").
import { describe, it, expect } from "vitest";
import { formatLookupKeys, formatExtensionKey, associationKey } from "./formatPathKeys";

describe("formatLookupKeys", () => {
  it.each([
    ["/x/notes.md", ["notes.md", "md"]],
    ["/x/.env.local", [".env.local", ".env", "local"]],
    ["/x/.gitignore", [".gitignore"]],
    ["/x/Dockerfile", ["dockerfile"]],
    ["C:\\proj\\app.TS", ["app.ts", "ts"]],
    ["", []],
  ])("%s → %j", (path, expected) => {
    expect(formatLookupKeys(path)).toEqual(expected);
  });

  it("strips a URL query and fragment before splitting the basename", () => {
    expect(formatLookupKeys("file:///x/notes.md?reload=1")).toEqual(["notes.md", "md"]);
  });

  it("keeps a literal '#' in a local basename when a real extension follows it", () => {
    expect(formatLookupKeys("/x/photo#1.png")).toEqual(["photo#1.png", "png"]);
  });
});

describe("formatExtensionKey", () => {
  it.each([
    ["/x/notes.md", "md"],
    ["/x/app.TS", "ts"],
    ["/x/.env.local", "local"],
    ["/x/photo#1.png", "png"],
  ])("%s → %s", (path, expected) => {
    expect(formatExtensionKey(path)).toBe(expected);
  });

  it.each([
    // An extensionless file whose whole NAME happens to be a registered
    // extension: `md` is not a markdown file, and treating it as one is how a
    // pathed file reached the WYSIWYG editor with no extension at all.
    "/x/md",
    "/x/html",
    "/x/Dockerfile",
    "/x/.gitignore",
    "/x/.env",
    "/x/.env.",
    "",
  ])("%s has no extension key", (path) => {
    expect(formatExtensionKey(path)).toBeNull();
  });

  it("agrees with formatLookupKeys: an extension key is always one of the keys", () => {
    for (const path of ["/x/notes.md", "/x/.env.local", "/x/md", "/x/Dockerfile"]) {
      const ext = formatExtensionKey(path);
      if (ext !== null) expect(formatLookupKeys(path)).toContain(ext);
    }
  });
});

describe("associationKey", () => {
  it.each([
    ["/x/notes.txt", "txt"],
    ["/x/.env.local", ".env"],
    ["/x/.gitignore", ".gitignore"],
    ["/x/Dockerfile", "dockerfile"],
  ])("%s → %s", (path, expected) => {
    expect(associationKey(path)).toBe(expected);
  });

  it("returns null when the path reduces to nothing", () => {
    expect(associationKey("")).toBeNull();
  });
});
