/**
 * WI-FL0.2 — header-reference gate self-test.
 *
 * Drives the pure functions against fixture trees in a temp dir, and the REAL
 * CLI as a subprocess for the exit-code and message contract. Every grammar the
 * repo was measured to use is pinned here in both directions — a target that
 * resolves, and the same shape pointing at nothing — because the gate's value
 * is precision: a resolver that accepts too much reads as "headers are fine",
 * and one that accepts too little gets baselined into silence.
 *
 * @coordinates-with scripts/check-header-references.mjs — the CLI under test
 * @coordinates-with scripts/lib/headerReferences.mjs — the grammar and collection
 * @coordinates-with scripts/lib/headerReferenceTargets.mjs — target resolution
 * @module scripts/check-header-references.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { BASELINE_PATH, collectFindings, compareWithBaseline, extractReferences, parseArgs, resolveReference } from "./check-header-references.mjs";
import {
  BASELINE_HEADER,
  KINDS,
  commentLines,
  expectedModulePaths,
  firstTarget,
  formatBaseline,
  identityKey,
  isMaintainerLocal,
  resolutionContext,
  validateBaseline,
} from "./lib/headerReferences.mjs";
import { RESOLVE_EXTENSIONS, RUST_ROOT, expandBraces, fsAt, globHits, resolutionBases, rustModuleDir, treeFor } from "./lib/headerReferenceTargets.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "check-header-references.mjs");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fixture tree from `{ "rel/path": content }`; `null` makes an empty directory. */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "header-refs-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    if (content === null) {
      mkdirSync(full, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}
const ts = (...lines) => `/**\n${lines.map((l) => ` * ${l}`).join("\n")}\n */\nexport {};\n`;
const rs = (...lines) => `${lines.map((l) => `//! ${l}`).join("\n")}\n`;
const keys = (root) => collectFindings(root).findings.map((f) => f.key);
const resolve = (root, file, target, kind = "coordinates-with") => resolveReference({ kind, target, line: 1, file }, resolutionContext(root));
function run(root, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, `--root=${root}`, ...args], { encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("extractReferences — the three grammars and their comment shapes", () => {
  it("reads @coordinates-with, @module and Plan: from a TS block header with line numbers", () => {
    const refs = extractReferences(ts("Purpose: x.", "@coordinates-with foo.ts — reads it", "@module utils/a", "Plan: dev-docs/plans/p.md §6"), "src/utils/a.ts");
    expect(refs).toEqual([
      { kind: "coordinates-with", target: "foo.ts", line: 3, file: "src/utils/a.ts" },
      { kind: "module-self", target: "utils/a", line: 4, file: "src/utils/a.ts" },
      { kind: "plan", target: "dev-docs/plans/p.md", line: 5, file: "src/utils/a.ts" },
    ]);
  });

  it("reads Rust //! and /// and plain // comments", () => {
    const src = "//! @coordinates-with workflow::state — x\n/// @coordinates-with a.rs\n// Plan: dev-docs/plans/p.md\nfn f() {}\n";
    expect(extractReferences(src, "src-tauri/src/x.rs").map((r) => [r.kind, r.target])).toEqual([
      ["coordinates-with", "workflow::state"],
      ["coordinates-with", "a.rs"],
      ["plan", "dev-docs/plans/p.md"],
    ]);
  });

  it.each([
    ["foo.ts — description", "foo.ts"],
    ["foo.ts (createCodeMirrorEditor)", "foo.ts"],
    ["foo.ts: what it does", "foo.ts"],
    ["foo.ts—attached dash", "foo.ts"],
    ["`menu_events.rs` (dispatches)", "menu_events.rs"],
    ['"quoted.ts"', "quoted.ts"],
    ["a.ts, b.ts, c.ts", "a.ts"],
    ["(future) src-tauri browser delegates", "src-tauri"],
    ["dev-docs/plans/p.md, work item WI-1.2", "dev-docs/plans/p.md"],
    ["sourcePopup/ — popup host", "sourcePopup/"],
    ["tools/{a,b}.ts", "tools/{a,b}.ts"],
    // audit R3 #182 — one pass stripped wrappers BEFORE punctuation, so a
    // combined form kept its closing quote/backtick and could never resolve.
    ['"foo.rs", and others', "foo.rs"],
    ["`foo.ts`.", "foo.ts"],
    ["'foo.ts';", "foo.ts"],
    ["`sourcePopup/`,", "sourcePopup/"],
  ])("firstTarget(%j) → %j", (rest, target) => {
    expect(firstTarget(rest)).toBe(target);
  });

  it("ignores a header quoted inside a template literal whose /** is not at line start, and tags on code lines", () => {
    const src = 'const HEADER = `/**\n * @module fixture\n * @coordinates-with x.ts — y\n */`;\nwrite(" * @module other");\n/**\n * @module real\n */\n';
    expect(extractReferences(src, "scripts/t.test.mjs")).toEqual([{ kind: "module-self", target: "real", line: 7, file: "scripts/t.test.mjs" }]);
  });

  it("reads a one-line block comment and a block that opens after imports", () => {
    const src = 'import x from "y";\n/** @module late */\n/**\n * @coordinates-with a.ts\n */\n';
    expect(extractReferences(src, "src/a.ts").map((r) => r.target)).toEqual(["late", "a.ts"]);
  });

  it("does not read Plan: or the tags mid-prose, and stops at the block close", () => {
    const src = "/**\n * The Plan: is not a reference; see @coordinates-with prose\n */ const after = 1; // @module code\n";
    expect(extractReferences(src, "src/a.ts")).toEqual([]);
    expect(commentLines("/* a */ b\n").map((l) => l.text)).toEqual([" a "]);
  });

  // audit R2 #181 — Rust block comments NEST and TypeScript's do not. A shared
  // boolean closed the outer Rust comment at the inner `*/`, so every reference
  // after it went unread; the same input in TS must still close at the first.
  it("tracks Rust block-comment DEPTH, while TypeScript still closes at the first terminator", () => {
    // The outer comment runs to line 5. Under the boolean model the inner
    // `*/` ended it, so line 3 was read as a fresh `//!` comment (giving
    // `workflow::state`) and line 4 — still inside the real comment — was read
    // as code and dropped.
    const src = "/*\n/* inner */\n//! @coordinates-with workflow::state\n@coordinates-with deep.rs\n*/\n@coordinates-with outside.rs\n";
    expect(extractReferences(src, "src-tauri/src/x.rs").map((r) => r.target)).toEqual(["deep.rs"]);
    // TypeScript's block comments do NOT nest: the same input really does
    // close at the inner `*/`, so line 3 is a fresh `//` comment there. The
    // two languages must disagree on this input, and now they do.
    expect(extractReferences(src, "src/x.ts").map((r) => r.target)).toEqual(["workflow::state"]);
  });

  it("does not read an Origin: line — a retired plan is recorded as prose, never as a reference", () => {
    const src = ts("Origin: MCP pruning plan (2026-05-04, retired) WI-1.2", "@module a");
    expect(extractReferences(src, "src/a.ts")).toEqual([{ kind: "module-self", target: "a", line: 3, file: "src/a.ts" }]);
  });
});

describe("path targets — every base a reader could mean", () => {
  const files = {
    "src/utils/a.ts": ts("@module utils/a"),
    "src/utils/b.ts": "",
    "src/utils/markdownPipeline/plugins/x.ts": "",
    "src/utils/deep/nested/c.ts": "",
    "src/stores/s.ts": "",
    "src/theme/themes/one.ts": "",
    "src/hooks/h.ts": "",
    "server/mcp/src/tools/a.ts": "",
    "server/mcp/src/tools/b.ts": "",
    "src-tauri/tauri.conf.json": "{}",
    "src-tauri/locales/en.yml": "",
    "src-tauri/src/lib.rs": "",
    "src-tauri/src/menu/localized.rs": "",
    "package.json": JSON.stringify({ devDependencies: { "@tauri-apps/plugin-log": "1" } }),
  };
  const root = tree(files);
  const from = "src/utils/a.ts";

  it.each([
    ["b.ts", "sibling with extension"],
    ["b", "extensionless sibling"],
    ["stores/s.ts", "src-relative"],
    ["stores", "bare directory"],
    ["stores/", "directory with trailing slash"],
    ["src-tauri/tauri.conf.json", "repo-relative"],
    ["@/stores/s", "@/ alias"],
    ["../stores/s.ts", "dot-relative"],
    ["theme/themes/*", "glob with one match"],
    ["lib.rs", "Rust file via the src-tauri/src base"],
    ["@tauri-apps/plugin-log", "declared dependency"],
  ])("%s resolves (%s)", (target) => {
    expect(resolve(root, from, target)).toMatchObject({ status: "resolved" });
  });

  it("treats `..config` as an ordinary root-relative name — only a `..` SEGMENT escapes the root", () => {
    const r = tree({ "..config": "", "src/a.ts": "" });
    expect(resolve(r, "src/a.ts", "..config")).toMatchObject({ status: "resolved", via: "location" });
    expect(resolve(r, "src/a.ts", "../outside.ts").status).toBe("unresolved");
  });

  it("resolves against an ancestor directory of the referencing file", () => {
    expect(resolve(root, "src/utils/deep/nested/c.ts", "markdownPipeline/plugins/x.ts")).toMatchObject({ status: "resolved", via: "location" });
  });

  it("falls back to a path suffix for a bare name or partial path, and says so", () => {
    expect(resolve(root, "src/hooks/h.ts", "s.ts")).toEqual({ status: "resolved", via: "tail" });
    expect(resolve(root, "src/hooks/h.ts", "plugins/x.ts")).toEqual({ status: "resolved", via: "tail" });
    expect(resolve(root, "src/hooks/h.ts", "@tauri-apps/plugin-log")).toEqual({ status: "resolved", via: "dependency" });
  });

  it.each([
    ["nope.ts", 'no file, directory or dependency "nope.ts"'],
    ["utils/s.ts", 'no file, directory or dependency "utils/s.ts"'],
    ["b.ts/", 'no directory "b.ts"'],
    ["theme/nothing/*", 'no file matches "theme/nothing/*"'],
    ["./s.ts", 'no file, directory or dependency "./s.ts"'],
    ["../nope.ts", 'no file, directory or dependency "../nope.ts"'],
    ["left-pad", 'no file, directory or dependency "left-pad"'],
  ])("%s is a finding: %s", (target, reason) => {
    const r = resolve(root, from, target);
    expect(r.status).toBe("unresolved");
    expect(r.reason).toContain(reason);
  });

  it("requires every brace alternative to exist", () => {
    expect(resolve(root, "server/mcp/src/x.ts", "tools/{a,b}.ts")).toMatchObject({ status: "resolved" });
    expect(resolve(root, "server/mcp/src/x.ts", "tools/{a,zzz}.ts").reason).toContain('"tools/zzz.ts"');
    expect(expandBraces("a/{b,c}/{d,e}.ts")).toEqual(["a/b/d.ts", "a/b/e.ts", "a/c/d.ts", "a/c/e.ts"]);
  });

  it("gives a Rust file the crate root as a base, but does not index assets outside the scan trees", () => {
    expect(resolve(root, "src-tauri/src/menu/localized.rs", "locales/en.yml")).toMatchObject({ status: "resolved", via: "location" });
    expect(resolve(root, "src-tauri/src/menu/localized.rs", "en.yml").status).toBe("unresolved");
    expect(resolve(root, "src-tauri/src/lib.rs", "hooks/h.ts")).toMatchObject({ status: "resolved", via: "location" });
  });

  it("orders bases: directory, ancestors to the tree root, src, src-tauri/src, package root, repo root", () => {
    expect(resolutionBases("x", "src/utils/deep/c.ts", treeFor("src/utils/deep/c.ts"))).toEqual(["src/utils/deep", "src/utils", "src", RUST_ROOT, "."]);
    expect(resolutionBases("x", "server/mcp/src/tools/t.ts", treeFor("server/mcp/src/tools/t.ts"))).toEqual(["server/mcp/src/tools", "server/mcp/src", "src", RUST_ROOT, "server/mcp", "."]);
    expect(resolutionBases("../x", "src/a/b.ts", treeFor("src/a/b.ts"))).toEqual(["src/a"]);
    expect(RESOLVE_EXTENSIONS).toContain(".d.ts");
    expect(globHits(fsAt(root), "src", "theme/*/one.ts")).toBe(1);
  });

  // audit R2 #172 — `readdir` never lists `.` or `..`, so an anchored glob
  // died on its FIRST segment and could not resolve at all.
  it("resolves an anchored glob, whose `.`/`..` segments are path arithmetic", () => {
    expect(globHits(fsAt(root), "src/theme", "./themes/*.ts", { require: "file" })).toBe(1);
    expect(globHits(fsAt(root), "src/theme/themes", "../themes/*.ts", { require: "file" })).toBe(1);
    expect(resolve(root, "src/theme/themes/one.ts", "./*.ts")).toMatchObject({ status: "resolved" });
    expect(resolve(root, "src/theme/themes/one.ts", "../themes/*.ts")).toMatchObject({ status: "resolved" });
  });

  // audit R2 #173 — the header's contract is "at least one FILE matches"; a
  // directory whose name ends in `.ts` used to satisfy it.
  it("requires a terminal glob match to be a file, or a directory when the target asks for one", () => {
    const r = tree({ "src/a.ts": "", "src/pkg.ts/inner.ts": "", "src/dir/keep.ts": "" });
    expect(globHits(fsAt(r), "src", "*.ts")).toBe(2); // unconstrained: the file and the directory
    expect(globHits(fsAt(r), "src", "*.ts", { require: "file" })).toBe(1);
    expect(resolve(r, "src/a.ts", "pk*.ts").status).toBe("unresolved");
    expect(resolve(r, "src/a.ts", "d*/")).toMatchObject({ status: "resolved" });
    expect(resolve(r, "src/a.ts", "a*/").status).toBe("unresolved");
  });

  // audit R2 #174 — one mutable `via` made brace provenance order-dependent,
  // so the suffix fallback the header reports per run could be hidden by a
  // later alternative.
  it("reports the suffix fallback whichever brace alternative used it", () => {
    expect(resolve(root, "src/hooks/h.ts", "{s.ts,@tauri-apps/plugin-log}")).toEqual({ status: "resolved", via: "tail" });
    expect(resolve(root, "src/hooks/h.ts", "{@tauri-apps/plugin-log,s.ts}")).toEqual({ status: "resolved", via: "tail" });
  });

  // audit R2 #175 — a manifest declares the PACKAGE, never its subpaths, so an
  // exact-key lookup rejected every deep import a header could name.
  it("resolves a subpath of a declared dependency", () => {
    expect(resolve(root, from, "@tauri-apps/plugin-log/dist/index.js")).toEqual({ status: "resolved", via: "dependency" });
    expect(resolve(root, from, "@tauri-apps/plugin-nope/x").status).toBe("unresolved");
  });
});

describe("Rust :: module paths", () => {
  const root = tree({
    "src-tauri/src/lib.rs": "",
    "src-tauri/src/workflow/mod.rs": "",
    "src-tauri/src/workflow/state.rs": "",
    "src-tauri/src/workflow/guards.rs": "",
    "src-tauri/src/pdf_export/mod.rs": "",
    "src-tauri/src/pdf_export/renderer/mod.rs": "",
    "src/a.ts": "",
  });

  it.each([
    ["src-tauri/src/lib.rs", "workflow::state"],
    ["src-tauri/src/lib.rs", "crate::workflow::state"],
    ["src-tauri/src/lib.rs", "pdf_export::renderer"],
    ["src-tauri/src/workflow/guards.rs", "super::state"],
    ["src-tauri/src/workflow/mod.rs", "self::state"],
    ["src/a.ts", "workflow::state"],
  ])("%s → %s resolves", (file, target) => {
    expect(resolve(root, file, target)).toEqual({ status: "resolved", via: "location" });
  });

  it("stops a super:: chain at the crate root instead of matching files above src-tauri/src", () => {
    expect(resolve(root, "src-tauri/src/workflow/guards.rs", "super::super::workflow::state")).toEqual({ status: "resolved", via: "location" });
    const r = resolve(root, "src-tauri/src/workflow/guards.rs", "super::super::super::src::workflow::state");
    expect(r.status).toBe("unresolved");
    expect(r.reason).toContain(`a super:: climbs above ${RUST_ROOT}`);
  });

  // audit R2 #177 — `crate::` left an EMPTY relative path, which joined to the
  // base itself; the base is a directory that exists, so it "resolved".
  it.each(["crate::", "self::", "super::", "::"])("refuses %j, which names no module after its qualifier", (target) => {
    const r = resolve(root, "src-tauri/src/workflow/guards.rs", target);
    expect(r.status).toBe("unresolved");
    expect(r.reason).toContain("names no module after its qualifier");
  });

  it("names the module files it looked for when nothing matches", () => {
    const r = resolve(root, "src-tauri/src/lib.rs", "workflow::missing");
    expect(r.status).toBe("unresolved");
    expect(r.reason).toContain("workflow/missing.rs or workflow/missing/mod.rs");
    expect(rustModuleDir("src-tauri/src/workflow/guards.rs")).toBe("src-tauri/src/workflow/guards");
    expect(rustModuleDir("src-tauri/src/workflow/mod.rs")).toBe("src-tauri/src/workflow");
  });
});

describe("@module — the file's own path, per tree convention", () => {
  const root = tree({
    "src/theme/x.ts": "",
    "src/lib/foo/index.ts": "",
    "src/a/b.test.ts": "",
    "src/x.d.ts": "",
    "scripts/lib/p.mjs": "",
    "e2e/lib/q.mjs": "",
    "server/mcp/src/tools/t.ts": "",
    "src-tauri/src/hot_exit/dedup.rs": "",
    "src-tauri/src/window_status/mod.rs": "",
    "src-tauri/src/bin/pdf_smoke/main.rs": "",
    "src-tauri/src/command_error.rs": '#[path = "command_error_from.rs"]\nmod from_impls;\n',
    "src-tauri/src/command_error_from.rs": "",
  });
  const expected = (file) => [...expectedModulePaths(file, fsAt(root))].sort();

  it.each([
    ["src/theme/x.ts", ["theme/x"]],
    ["src/lib/foo/index.ts", ["lib/foo", "lib/foo/index"]],
    ["src/a/b.test.ts", ["a/b.test"]],
    ["src/x.d.ts", ["x"]],
    ["scripts/lib/p.mjs", ["scripts/lib/p"]],
    ["e2e/lib/q.mjs", ["e2e/lib/q"]],
    ["server/mcp/src/tools/t.ts", ["tools/t"]],
    ["src-tauri/src/hot_exit/dedup.rs", ["hot_exit/dedup", "hot_exit::dedup"]],
    ["src-tauri/src/window_status/mod.rs", ["window_status"]],
    ["src-tauri/src/bin/pdf_smoke/main.rs", ["bin/pdf_smoke", "bin::pdf_smoke"]],
    ["src-tauri/src/command_error_from.rs", ["command_error/from_impls", "command_error::from_impls", "command_error_from"]],
  ])("%s accepts %j", (file, accepted) => {
    expect(expected(file)).toEqual(accepted);
  });

  it("flags a mismatch as module-self with the expected path in the reason", () => {
    const r = resolve(root, "src/theme/x.ts", "utils/x", "module-self");
    expect(r).toEqual({ status: "unresolved", reason: '@module says "utils/x" but this file is "theme/x"' });
    expect(resolve(root, "scripts/lib/p.mjs", "lib/p", "module-self").status).toBe("unresolved");
    expect(resolve(root, "src/a/b.test.ts", "a/b", "module-self").status).toBe("unresolved");
    expect(resolve(root, "src-tauri/src/command_error_from.rs", "command_error::old", "module-self").status).toBe("unresolved");
  });
});

describe("dev-docs/ references are maintainer-local", () => {
  const src = ts("Plan: dev-docs/plans/x.md", "@coordinates-with dev-docs/plans/gone.md — evidence");

  it("are skipped, never findings, when dev-docs/ is absent", () => {
    const { findings, stats } = collectFindings(tree({ "src/a.ts": src }));
    expect(findings).toEqual([]);
    expect(stats).toMatchObject({ devDocsPresent: false, maintainerLocalSkipped: 2, maintainerLocalChecked: 0 });
  });

  it("are checked like any other reference when dev-docs/ is present — keyed on its README.md index, not the bare directory", () => {
    // A directory without the index is a transient fixture, not a dev-docs.
    expect(collectFindings(tree({ "src/a.ts": src, "dev-docs/plans/x.md": "# plan" })).stats.devDocsPresent).toBe(false);
    const { findings, stats } = collectFindings(tree({ "src/a.ts": src, "dev-docs/README.md": "# index", "dev-docs/plans/x.md": "# plan" }));
    expect(findings.map((f) => f.key)).toEqual(["src/a.ts|coordinates-with|dev-docs/plans/gone.md"]);
    expect(stats).toMatchObject({ devDocsPresent: true, maintainerLocalChecked: 2, maintainerLocalSkipped: 0 });
    expect(isMaintainerLocal("../../dev-docs/x.md")).toBe(true);
    expect(isMaintainerLocal("src/dev-docs.ts")).toBe(false);
    // audit R3 #183 — matched by SEGMENT, so the directory itself counts. The
    // prefix/substring form required a following slash, and a bare `dev-docs`
    // was reported unresolvable on every machine without the folder (i.e. CI).
    expect(isMaintainerLocal("dev-docs")).toBe(true);
    expect(isMaintainerLocal("../dev-docs")).toBe(true);
    expect(isMaintainerLocal("website/dev-docs")).toBe(true);
    expect(isMaintainerLocal("dev-docs-archive/x.md")).toBe(false);
  });
});

describe("collectFindings — scan scope", () => {
  it("scans the seven trees, skips generated and vendored paths, and sorts by identity key", () => {
    const stale = ts("@coordinates-with nope.ts");
    const root = tree({
      "src/z.ts": stale,
      "src/a.tsx": stale,
      "src/styles.css": "/* @coordinates-with nope.ts */",
      "src/notes.md": "@coordinates-with nope.ts",
      "src/gen/generated/g.ts": stale,
      "src/node_modules/m/i.ts": stale,
      "src/dist/d.ts": stale,
      "src/coverage/c.ts": stale,
      "src/marked.ts": `// @generated by a tool\n${stale}`,
      "src-tauri/src/r.rs": rs("@coordinates-with nope.rs"),
      "src-tauri/target/t.rs": rs("@coordinates-with nope.rs"),
      "server/mcp/src/m.ts": stale,
      "server/content/src/c.mts": stale,
      "scripts/s.mjs": stale,
      ".claude/hooks/h.mjs": stale,
      "e2e/e.js": stale,
      "website/w.ts": stale,
      "dev-docs/d.ts": stale,
    });
    const { findings, stats } = collectFindings(root);
    expect(findings.map((f) => f.key)).toEqual([
      ".claude/hooks/h.mjs|coordinates-with|nope.ts",
      "e2e/e.js|coordinates-with|nope.ts",
      "scripts/s.mjs|coordinates-with|nope.ts",
      "server/content/src/c.mts|coordinates-with|nope.ts",
      "server/mcp/src/m.ts|coordinates-with|nope.ts",
      "src-tauri/src/r.rs|coordinates-with|nope.rs",
      "src/a.tsx|coordinates-with|nope.ts",
      "src/z.ts|coordinates-with|nope.ts",
    ]);
    expect(stats).toMatchObject({ files: 8, generatedSkipped: 1, references: { "coordinates-with": 8, "module-self": 0, plan: 0 } });
    expect(findings[0]).toMatchObject({ file: ".claude/hooks/h.mjs", line: 2, kind: "coordinates-with", target: "nope.ts" });
    expect(identityKey(findings[0])).toBe(findings[0].key);
  });

  it("skips a file only on a @generated COMMENT directive, not the word in a string or in prose", () => {
    const stale = ts("@coordinates-with nope.ts");
    const root = tree({
      "src/directive.ts": `/* @generated by codegen */\n${stale}`,
      "src/in-string.ts": `const marker = "@generated";\n${stale}`,
      "src/in-prose.ts": `// not @generated — hand-written\n${stale}`,
      "src/late.ts": `${stale}${"\n".repeat(25)}// @generated\n`,
      // A block comment quoted inside a TEMPLATE LITERAL, opening at line
      // START — the shape the line model alone read as a real comment, so a
      // quoted `@generated` skipped the whole file and its real header went
      // unread (audit 20260907 #84). Its own stale reference must still be a
      // finding, which is the loud half.
      "src/quoted-directive.ts": `const FIXTURE = \`\n/**\n * @generated by codegen\n */\n\`;\n${stale}`,
    });
    const { findings, stats } = collectFindings(root);
    expect(findings.map((f) => f.file)).toEqual(["src/in-prose.ts", "src/in-string.ts", "src/late.ts", "src/quoted-directive.ts"]);
    expect(stats.generatedSkipped).toBe(1);
  });

  it("never follows a symlink: a link into its own tree terminates, a link out of the root is not scanned", () => {
    const stale = ts("@coordinates-with nope.ts");
    const outside = tree({ "elsewhere.ts": stale });
    const root = tree({ "src/a.ts": stale, "src/sub/b.ts": "" });
    symlinkSync(".", path.join(root, "src/loop"));
    symlinkSync(outside, path.join(root, "src/outside"));
    const { findings, stats } = collectFindings(root);
    expect(findings.map((f) => f.key)).toEqual(["src/a.ts|coordinates-with|nope.ts"]);
    expect(stats.files).toBe(2);
    // …but a header may still name the link, which exists.
    expect(resolve(root, "src/a.ts", "outside")).toMatchObject({ status: "resolved" });
  });

  it("threads custom trees through resolution, not just traversal", () => {
    const root = tree({ "pkg/src/a.ts": ts("@module a", "@coordinates-with b.ts"), "pkg/src/lib/b.ts": "" });
    const custom = [{ dir: "pkg/src", moduleBase: "pkg/src", packageRoot: "pkg", lang: "ts" }];
    // Under the shipped trees `pkg/` is nobody's: `@module a` reads as
    // "pkg/src/a" and `b.ts` is not in the tail index.
    expect(collectFindings(root).findings).toEqual([]);
    expect(collectFindings(root, { trees: custom }).findings).toEqual([]);
    expect(resolveReference({ kind: "module-self", target: "a", line: 1, file: "pkg/src/a.ts" }, { root, trees: custom })).toMatchObject({ status: "resolved" });
    expect(resolveReference({ kind: "module-self", target: "a", line: 1, file: "pkg/src/a.ts" }, { root })).toMatchObject({ status: "unresolved" });
    expect(resolveReference({ kind: "coordinates-with", target: "b.ts", line: 1, file: "pkg/src/a.ts" }, { root, trees: custom })).toMatchObject({ status: "resolved", via: "tail" });
    expect(resolveReference({ kind: "coordinates-with", target: "b.ts", line: 1, file: "pkg/src/a.ts" }, { root })).toMatchObject({ status: "unresolved" });
  });

  it("fails, naming the manifest, when a package.json it must read is malformed", () => {
    const root = tree({ "package.json": "{ nope", "src/a.ts": "" });
    expect(() => collectFindings(root)).toThrow("package.json: cannot parse package manifest");
  });
});

describe("compareWithBaseline — two-way identity", () => {
  const f = (key) => ({ key });

  it("passes only on an exact match", () => {
    expect(compareWithBaseline([f("a|coordinates-with|x"), f("b|plan|y")], { entries: ["b|plan|y", "a|coordinates-with|x"] })).toEqual({ unlisted: [], stale: [], ignored: [] });
  });

  it("reports an unlisted finding and a stale entry separately", () => {
    expect(compareWithBaseline([f("a|coordinates-with|x")], { entries: ["b|plan|y"] })).toEqual({ unlisted: ["a|coordinates-with|x"], stale: ["b|plan|y"], ignored: [] });
  });

  it("ignores, rather than fails, a dev-docs entry it cannot verify; verifies it where dev-docs exists", () => {
    const base = { entries: ["src/a.ts|plan|dev-docs/plans/x.md", "src/b.ts|coordinates-with|../dev-docs/y.md"] };
    expect(compareWithBaseline([], base, { devDocsPresent: false })).toEqual({ unlisted: [], stale: [], ignored: base.entries });
    expect(compareWithBaseline([], base, { devDocsPresent: true })).toEqual({ unlisted: [], stale: base.entries, ignored: [] });
  });

  it("validateBaseline fails closed on anything but unique <file>|<kind>|<target> strings with a known kind", () => {
    expect(() => validateBaseline({ files: [] })).toThrow('expected { "entries": [...] }');
    expect(() => validateBaseline({ entries: [{ file: "a" }] })).toThrow("not a");
    expect(() => validateBaseline({ entries: ["a|plan"] })).toThrow("not a");
    expect(() => validateBaseline({ entries: ["a|bogus|c"] })).toThrow("not a");
    expect(() => validateBaseline({ entries: ["|plan|c"] })).toThrow("not a");
    expect(() => validateBaseline({ entries: ["a|plan|"] })).toThrow("not a");
    expect(() => validateBaseline({ entries: ["a|plan|c", "a|plan|c"] })).toThrow("duplicate");
    expect(validateBaseline({ entries: ["a|plan|c|d"] })).toEqual({ entries: ["a|plan|c|d"] });
  });

  it("formatBaseline writes the header, sorted unique entries and a trailing newline", () => {
    const doc = JSON.parse(formatBaseline(["b|k|t", "a|k|t", "b|k|t"]));
    expect(doc).toEqual({ "//": BASELINE_HEADER, entries: ["a|k|t", "b|k|t"] });
    expect(formatBaseline([]).endsWith("\n")).toBe(true);
    expect(KINDS).toEqual(["coordinates-with", "module-self", "plan"]);
  });
});

describe("CLI — exit codes and messages", () => {
  const fixture = () =>
    tree({
      "src/a.ts": ts("@coordinates-with gone.ts — stale", "@module a"),
      "src/b.ts": ts("@module wrong/b"),
      "src/ok.ts": ts("@coordinates-with a.ts", "@module ok"),
      "scripts/s.mjs": ts("@module scripts/s"),
    });
  const EXPECTED = ["src/a.ts|coordinates-with|gone.ts", "src/b.ts|module-self|wrong/b"];

  it("fails closed without a baseline, --update measures one (sorted), and the gate is then green", () => {
    const root = fixture();
    const missing = run(root);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain("fails closed");

    const update = run(root, "--update");
    expect(update.status).toBe(0);
    expect(update.out).toContain("Wrote 2 entries");
    const doc = JSON.parse(readFileSync(path.join(root, BASELINE_PATH), "utf8"));
    expect(doc.entries).toEqual(EXPECTED);
    expect(doc["//"]).toEqual(BASELINE_HEADER);

    const green = run(root);
    expect(green.status).toBe(0);
    expect(green.out).toContain("✅ Header references: 6 checked across 4 files; 2 known-stale, all baselined.");
  });

  it("fails on an unlisted finding, naming file:line, kind, target and the no-append rule", () => {
    const root = fixture();
    run(root, "--update");
    writeFileSync(path.join(root, "src/ok.ts"), ts("@coordinates-with also-gone.ts", "@module ok"));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("1 header reference(s) do not resolve and are not baselined");
    expect(r.out).toContain("src/ok.ts:2  [coordinates-with] also-gone.ts");
    expect(r.out).toContain("Do NOT append");
  });

  it("fails on a stale entry once the header is fixed — record the win", () => {
    const root = fixture();
    run(root, "--update");
    writeFileSync(path.join(root, "src/b.ts"), ts("@module b"));
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("1 baselined finding(s) no longer occur");
    expect(r.out).toContain("src/b.ts|module-self|wrong/b");
    expect(run(root, "--update").out).toContain("(+0 / -1)");
    expect(run(root).status).toBe(0);
  });

  it("--report groups findings by kind with reasons and info lines, and keeps the verdict", () => {
    const root = fixture();
    // No baseline yet: the report prints, and the verdict is still the
    // documented exit 1 — --report is a view, not a way to skip the gate.
    const before = run(root, "--report");
    expect(before.status).toBe(1);
    expect(before.out).toContain("fails closed");
    for (const kind of KINDS) expect(before.out).toContain(`## ${kind} —`);
    expect(before.out).toContain("## coordinates-with — 1 finding(s) of 2 reference(s)");
    expect(before.out).toContain('@module says "wrong/b" but this file is "b"');
    expect(before.out).toContain("4 source files scanned");
    expect(before.out).toContain("dev-docs/ absent: 0 maintainer-local reference(s) skipped");
    expect(before.out).toContain("Resolved 4 from the referencing location");
    run(root, "--update");
    writeFileSync(path.join(root, "src/ok.ts"), ts("@coordinates-with also-gone.ts", "@module ok"));
    expect(run(root, "--report").status).toBe(1);
  });

  it("--update keeps dev-docs entries it cannot verify, and warns when the list grows", () => {
    const root = fixture();
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    writeFileSync(path.join(root, BASELINE_PATH), formatBaseline(["src/a.ts|plan|dev-docs/plans/x.md"]));
    const r = run(root, "--update");
    expect(r.status).toBe(0);
    expect(JSON.parse(readFileSync(path.join(root, BASELINE_PATH), "utf8")).entries).toEqual([EXPECTED[0], "src/a.ts|plan|dev-docs/plans/x.md", EXPECTED[1]]);
    expect(r.out).toContain("(+2 / -0)");
    expect(r.out).toContain("The list grew");
    expect(run(root).out).toContain("1 dev-docs/ entry unverifiable here");
  });

  it("--update refuses to overwrite a baseline it cannot parse; only a MISSING one is the first measurement", () => {
    const root = fixture();
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    const baseline = path.join(root, BASELINE_PATH);
    writeFileSync(baseline, "{ not json");
    const r = run(root, "--update");
    expect(r.status).toBe(1);
    expect(r.out).toContain("refuses to overwrite");
    expect(readFileSync(baseline, "utf8")).toBe("{ not json");
    writeFileSync(baseline, JSON.stringify({ entries: ["a|b"] }));
    expect(run(root, "--update").status).toBe(1);
    expect(readFileSync(baseline, "utf8")).toBe(JSON.stringify({ entries: ["a|b"] }));
  });

  it("fails, naming the manifest, when a package.json it must read is malformed", () => {
    const root = fixture();
    writeFileSync(path.join(root, "package.json"), "{ nope");
    const r = run(root);
    expect(r.status).toBe(1);
    expect(r.out).toContain("package.json: cannot parse package manifest");
  });

  it("exits 64 on a bad invocation", () => {
    const root = fixture();
    expect(run(root, "--bogus").status).toBe(64);
    expect(spawnSync(process.execPath, [SCRIPT, "--root=/nonexistent/dir"], { encoding: "utf8" }).status).toBe(64);
    expect(() => parseArgs(["--nope"], root)).toThrow("unknown argument");
    expect(parseArgs(["--update", "--report"], root)).toEqual({ update: true, report: true, root });
    expect(parseArgs(["--root", root], "/elsewhere").root).toBe(root);
    // audit R2 #51 — `path.resolve("")` is the CWD, so an empty value used to
    // resolve to wherever the caller stood and the scan reported a verdict
    // about a tree nobody named. Both spellings.
    expect(() => parseArgs(["--root="], root)).toThrow("needs a directory path");
    expect(() => parseArgs(["--root", "  "], root)).toThrow("needs a directory path");
    expect(spawnSync(process.execPath, [SCRIPT, "--root="], { encoding: "utf8" }).status).toBe(64);
  });

  // audit R2 #53 — a direct write TRUNCATES first, so an interrupted or failed
  // --update left a partial baseline behind. The write is a temp file plus a
  // rename now; a rename that cannot happen leaves the previous file intact.
  it("--update leaves no temporary file behind, and refuses cleanly when it cannot write", () => {
    const root = fixture();
    mkdirSync(path.join(root, "scripts"), { recursive: true });
    expect(run(root, "--update").status).toBe(0);
    const dir = path.join(root, "scripts");
    expect(readdirSync(dir).filter((f) => f.includes(".tmp-"))).toEqual([]);
    // A tree with no `scripts/` directory at all: the baseline reads as MISSING
    // (the first-measurement case, so --update proceeds), and the write then
    // cannot happen. It used to escape as an unhandled ENOENT stack trace that
    // never mentioned --update; and a direct write TRUNCATES first, so the
    // failure had to be caught before any byte reached the real path.
    const noScripts = tree({ "src/a.ts": ts("@coordinates-with gone.ts — stale", "@module a") });
    const blocked = run(noScripts, "--update");
    expect(blocked.status).toBe(1);
    expect(blocked.out).toContain("Cannot write the header-reference baseline");
    expect(blocked.out).toContain("the previous baseline is intact");
    expect(blocked.out).not.toContain("at Object.");
  });
});

describe("live tree", () => {
  const { findings, stats } = collectFindings(REPO);

  it("still sees the repository's headers — an extractor collapse would read as a clean tree", () => {
    expect(stats.files).toBeGreaterThan(1000);
    expect(stats.references["coordinates-with"]).toBeGreaterThan(1000);
    expect(stats.references["module-self"]).toBeGreaterThan(500);
  });

  it("carries a canonical baseline: valid, sorted, unique, exactly what --update writes", () => {
    const raw = readFileSync(path.join(REPO, BASELINE_PATH), "utf8");
    const { entries } = validateBaseline(JSON.parse(raw));
    expect(raw).toBe(formatBaseline(entries));
    expect(findings.every((f) => typeof f.reason === "string" && f.reason.length > 0)).toBe(true);
  });
});
