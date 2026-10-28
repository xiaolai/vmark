// WI-RA16.5 — every file outside src-tauri that the Rust crate compiles in or its tests read is in ci.yml's `rust` path filter
/**
 * The Rust tier runs only when the `rust` path filter matches, and the filter
 * was `src-tauri/**`. The crate does not stop at that directory: it
 * `include_str!`s frontend files into the binary, and its tests read frontend
 * sources to pin a contract (the PDF export progress keys in
 * `src/export/PdfExportDialog.tsx`, the CommandError wire fixture). A pull
 * request that edits only one of those changes what `cargo test` does and
 * runs none of it — the breakage lands on main and is first seen by whoever
 * next touches Rust.
 *
 * So the inputs are DERIVED from the Rust sources here, and each must be
 * matched by the filter. A new `include_str!` of a frontend file fails this
 * test until the filter names it.
 *
 * Two reference forms are read:
 *   - `include_str!("…")` / `include_bytes!("…")`, relative to the source file;
 *   - a string literal starting with `../`, relative to the crate root — the
 *     `Path::new(env!("CARGO_MANIFEST_DIR")).join("../…")` form.
 * Only paths that resolve to a TRACKED file outside `src-tauri/` count, so a
 * literal like `"../../etc/passwd"` in a traversal test is not an input.
 *
 * @coordinates-with .github/workflows/ci.yml — the `changes` job's `rust` filter
 * @module scripts/check-rust-filter-inputs.test
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

const REPO = path.resolve(import.meta.dirname, "..");
const CRATE = "src-tauri";

const tracked = new Set(
  execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\u0000")
    // A file deleted in the working tree but not yet in the index has nothing to read.
    .filter((f) => f && existsSync(path.join(REPO, f))),
);

/** Repo-relative POSIX path for `relative` resolved against `fromDir`. */
const resolveFrom = (fromDir, relative) => path.posix.normalize(path.posix.join(fromDir, relative));

/**
 * Out-of-crate tracked files one Rust source refers to.
 *
 * `file` is the repo-relative path of the source; `text` its content.
 */
function outOfCrateInputs(file, text, trackedFiles) {
  const found = new Set();
  const consider = (candidate) => {
    if (candidate.startsWith(`${CRATE}/`) || candidate.startsWith("..")) return;
    if (trackedFiles.has(candidate)) found.add(candidate);
  };
  for (const match of text.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"/g)) {
    consider(resolveFrom(path.posix.dirname(file), match[1]));
  }
  for (const match of text.matchAll(/"(\.\.\/[^"\n]+)"/g)) {
    consider(resolveFrom(CRATE, match[1]));
  }
  return [...found];
}

/** Whether a `dorny/paths-filter` pattern list covers `file`. */
function covered(patterns, file) {
  return patterns.some((pattern) =>
    pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) : pattern === file,
  );
}

describe("outOfCrateInputs", () => {
  const files = new Set(["src/a.json", "src/deep/b.js", "resources/in-crate.md", "src-tauri/resources/x.md"]);

  it("resolves include_str! relative to the source file", () => {
    expect(outOfCrateInputs("src-tauri/src/x.rs", 'const A: &str = include_str!("../../src/a.json");', files)).toEqual([
      "src/a.json",
    ]);
    expect(
      outOfCrateInputs("src-tauri/src/m/x.rs", 'include_bytes!(\n    "../../../src/deep/b.js"\n)', files),
    ).toEqual(["src/deep/b.js"]);
  });

  it("resolves a `../` literal relative to the crate root", () => {
    expect(outOfCrateInputs("src-tauri/src/m/x.test.rs", 'root.join("../src/a.json")', files)).toEqual(["src/a.json"]);
  });

  it("ignores a file inside the crate, an untracked path and a path that leaves the repository", () => {
    const text = [
      'include_str!("../resources/x.md")',
      'join("../src/not-tracked.json")',
      'validate("../../etc/passwd")',
      'join("../")',
    ].join("\n");
    expect(outOfCrateInputs("src-tauri/src/x.rs", text, files)).toEqual([]);
  });

  it("reports a file once however many times it is referenced", () => {
    const text = 'include_str!("../../src/a.json"); join("../src/a.json");';
    expect(outOfCrateInputs("src-tauri/src/x.rs", text, files)).toEqual(["src/a.json"]);
  });
});

describe("covered", () => {
  it("matches an exact path and a `/**` prefix, and nothing looser", () => {
    expect(covered(["src-tauri/**"], "src-tauri/src/lib.rs")).toBe(true);
    expect(covered(["src/a.json"], "src/a.json")).toBe(true);
    expect(covered(["src/a.json"], "src/a.json.bak")).toBe(false);
    expect(covered(["src-tauri/**"], "src-tauri-other/x.rs")).toBe(false);
    expect(covered([], "src/a.json")).toBe(false);
  });
});

describe("ci.yml's rust filter covers what the crate reads", () => {
  const rustSources = [...tracked].filter((file) => file.startsWith(`${CRATE}/`) && file.endsWith(".rs"));
  const inputs = new Map();
  for (const file of rustSources) {
    for (const input of outOfCrateInputs(file, readFileSync(path.join(REPO, file), "utf8"), tracked)) {
      inputs.set(input, [...(inputs.get(input) ?? []), file]);
    }
  }

  const ci = parse(readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8"));
  const filterStep = ci.jobs.changes.steps.find((step) => String(step.uses ?? "").startsWith("dorny/paths-filter@"));
  const rustPatterns = parse(filterStep.with.filters).rust;

  it("the scan sees the inputs it exists for", () => {
    expect(rustSources.length).toBeGreaterThan(100);
    // One compiled-in file and one file a test reads; if neither is found the
    // scanner has stopped seeing references, not the crate stopped having them.
    expect([...inputs.keys()]).toContain("src/utils/mediaExtensions.json");
    expect([...inputs.keys()]).toContain("src/export/PdfExportDialog.tsx");
  });

  it("every out-of-crate input is matched by the filter", () => {
    const missing = [...inputs.entries()]
      .filter(([input]) => !covered(rustPatterns, input))
      .map(([input, readers]) => `${input} (read by ${readers.join(", ")})`);
    expect(missing, "add these to the `rust` filter in .github/workflows/ci.yml").toEqual([]);
  });

  it("every exact path the filter names still exists", () => {
    const dead = rustPatterns.filter((pattern) => !pattern.endsWith("/**") && !tracked.has(pattern));
    expect(dead, "these `rust` filter entries name no tracked file").toEqual([]);
  });

  // WI-RA24.13 — the reverse direction. A frontend file is in this filter only
  // because the crate reads it; once it stops, the entry runs the Rust tier on
  // every edit to that file for nothing, and its comment misstates the crate.
  it("names no frontend file the crate no longer reads", () => {
    const stale = rustPatterns.filter((pattern) => pattern.startsWith("src/") && !inputs.has(pattern));
    expect(stale, "the crate reads none of these; drop them from the `rust` filter").toEqual([]);
  });
});
