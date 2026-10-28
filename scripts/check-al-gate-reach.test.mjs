// WI-AL0.7 — an unrelated passing test cannot rescue evidence the probes do not read
/**
 * Sources the REAL `scripts/lib/al-gate.sh` inside a fixture tree, the way
 * check-al-gate-helpers.test.mjs does, and holds `al_tests_cover` and
 * `al_test_has` to the documented-subset contract: a linked test file whose
 * only mention of the scenario sits in a form the probes do not support — a
 * stored helper, an unused nested arrow, a registration under a branch or
 * handed to a fake iterator, a forwarded or aliased callback, a Rust test the
 * host does not run, a closure nothing invokes, a method call, an aliased type
 * path — fails, even with
 * a runnable, passing test beside it. The supported spelling of each passes,
 * so the harness provably reads the file. The `dod-syntax.mjs` CLI also names
 * the form it could not read. `al_test_for_target` judges a witness for a
 * NAMED target instead of the host: its file must be mounted for that target
 * and a #[test] built there must reach the scenario. It never claims the
 * test was executed, and its ok line says so.
 *
 * @coordinates-with scripts/lib/al-gate.sh — al_tests_cover, al_test_has, al_test_for_target
 * @coordinates-with scripts/rust-target-mount.mjs — the per-target mount check al_test_for_target makes
 * @coordinates-with scripts/dod-syntax.mjs — the --test-reach and ts-has-test-case probes
 * @module scripts/check-al-gate-reach.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HOST } from "./lib/dodSyntaxRustAttrs.mjs";

const REPO = path.resolve(import.meta.dirname, "..");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fixture tree holding `files` ({ relPath: body }). */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "al-gate-reach-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

/** Run one helper call in `root`; returns its pass/fail counts and output. */
function call(root, line) {
  const script = [
    "set -uo pipefail",
    `cd ${JSON.stringify(root)} || exit 99`,
    "EXEC=0",
    `source ${JSON.stringify(path.join(REPO, "scripts/lib/al-gate.sh"))}`,
    `source ${JSON.stringify(path.join(REPO, "scripts/lib/dod-assertions.sh"))}`,
    line,
    'echo "RESULT pass=$PASS fail=$FAIL"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 60_000, killSignal: "SIGKILL" });
  if (r.error) throw r.error;
  const out = `${r.stdout}${r.stderr}`;
  const m = /RESULT pass=(\d+) fail=(\d+)/.exec(out);
  if (!m) throw new Error(`the harness did not finish: ${out}`);
  return { pass: Number(m[1]), fail: Number(m[2]), out };
}

const TS_TEST = "src/a/__tests__/x.test.ts";
const RS_TEST = "src-tauri/src/a/x.test.rs";
const ts = (...lines) => ["// WI-X1.1 — header", 'import { expect, it } from "vitest";', 'it("unrelated", () => { expect(1).toBe(1); });', ...lines, ""].join("\n");
const rs = (...lines) => ["// WI-X1.1 — header", "#[test]", "fn unrelated() { assert_eq!(1, 1); }", ...lines, ""].join("\n");
const SCENARIO = "stale write";
const S = JSON.stringify(SCENARIO);

const TS_UNSUPPORTED = [
  ["a helper only stored in a const", ts(`function helper() { return ${S}; }`, 'it("t", () => { const stored = helper; void stored; });')],
  ["an unused arrow nested in a test", ts(`it("t", () => { const unused = () => ${S}; void 0; });`)],
  ["a registration under an if", ts(`if (Math.random() > 2) { it(${S}, () => {}); }`)],
  ["a registration handed to a fake map method", ts("const callbacks = { map(f) { this.saved = f; } };", `callbacks.map(() => it(${S}, () => {}));`)],
  ["a callback forwarded to another helper", ts("function run(f) { f(); }", "function forward(f) { run(f); }", `forward(() => it(${S}, () => {}));`)],
  ["a callback through a parameter alias", ts("function run(f) { const g = f; g(); }", `run(() => it(${S}, () => {}));`)],
  ["a case under skipIf(true)", ts(`it.skipIf(true)(${S}, () => {});`)],
  ["a reassigned callback parameter", ts("function run(f) { f = () => {}; f(); }", `run(() => it(${S}, () => {}));`)],
  ["a helper called after a return", ts(`function helper() { return ${S}; }`, 'it("t", () => { return; helper(); });')],
];

const TS_SUPPORTED = [
  ["a helper the test calls", ts(`function helper() { return ${S}; }`, 'it("t", () => { helper(); });')],
  ["a direct registration", ts(`it(${S}, () => {});`)],
  ["a callback a helper calls in straight line", ts("function run(f) { f(); }", `run(() => it(${S}, () => {}));`)],
];

const RS_HELPERS = "struct A; impl A { fn helper(&self) -> u8 { 1 } }\nstruct B; impl B { fn helper(&self) -> &'static str { \"stale write\" } }";
const RS_UNSUPPORTED = [
  ["a test under cfg(any())", rs("#[cfg(any())]", "#[test]", `fn t() { let _ = ${S}; }`)],
  ["an ignored test", rs("#[test]", "#[ignore]", `fn t() { let _ = ${S}; }`)],
  ["a test no tested target compiles", rs("#[cfg(all(unix, windows))]", "#[test]", `fn t() { let _ = ${S}; }`)],
  ["a method call on one of two types with the method", rs(RS_HELPERS, "#[test]", "fn t() { let a = A; let _b = B; a.helper(); }")],
  [
    "a type path through a use alias",
    rs(`mod types { pub struct A; impl A { pub fn helper() -> u8 { 1 } } pub struct C; impl C { pub fn helper() -> &'static str { ${S} } } }`, "use types::A as C;", "#[test]", "fn t() { let _ = C::helper(); }"),
  ],
];

// The gate runs `cargo test` on this host only, so a witness compiled for another target is not executed evidence.
const OFF_HOST = `#[cfg(not(target_os = "${HOST.os}"))]`;
RS_UNSUPPORTED.push(
  ["a test compiled only off the host", rs(OFF_HOST, "#[test]", `fn t() { let _ = ${S}; }`)],
  ["a test marker from one target and compilation from another", rs("#[cfg(unix)]", "#[cfg_attr(windows, test)]", `fn t() { let _ = ${S}; }`)],
  ["a sentinel in an unused closure", rs("#[test]", `fn t() { let unused = || ${S}; assert_eq!(1, 1); }`)],
);

const RS_SUPPORTED = [
  ["a called helper", rs(`fn helper() -> &'static str { ${S} }`, "#[test]", "fn t() { let _ = helper(); }")],
  ["a test compiled only on the host", rs(`#[cfg(target_os = "${HOST.os}")]`, "#[test]", `fn t() { let _ = ${S}; }`)],
];

describe("al_tests_cover: unsupported evidence beside a passing unrelated test", () => {
  it.each([...TS_UNSUPPORTED.map(([n, b]) => [n, TS_TEST, b]), ...RS_UNSUPPORTED.map(([n, b]) => [n, RS_TEST, b])])("fails for %s", (_n, file, body) => {
    const r = call(tree({ [file]: body }), "al_tests_cover WI-X1.1 'stale write' 'covers stale write'");
    expect(r.out).toContain("✗ covers stale write");
    expect(r.fail, r.out).toBe(1);
    expect(r.pass, r.out).toBe(0);
  });

  it.each([...TS_SUPPORTED.map(([n, b]) => [n, TS_TEST, b]), ...RS_SUPPORTED.map(([n, b]) => [n, RS_TEST, b])])("passes for %s", (_n, file, body) => {
    const r = call(tree({ [file]: body }), "al_tests_cover WI-X1.1 'stale write' 'covers stale write'");
    expect(r.pass, r.out).toBe(1);
    expect(r.fail, r.out).toBe(0);
  });
});

describe("al_test_has: one supported scenario cannot carry an unsupported one", () => {
  it("fails when the second scenario is only in a stored helper", () => {
    const body = ts('it("handles cjk", () => {});', `function helper() { return ${S}; }`, 'it("t", () => { const stored = helper; void stored; });');
    const r = call(tree({ [TS_TEST]: body }), "al_test_has WI-X1.1 'x[.]test' 'both' 'cjk' 'stale write'");
    expect(r.fail, r.out).toBe(1);
  });

  it("passes when both scenarios are reached", () => {
    const body = ts('it("handles cjk", () => {});', `it(${S}, () => {});`);
    const r = call(tree({ [TS_TEST]: body }), "al_test_has WI-X1.1 'x[.]test' 'both' 'cjk' 'stale write'");
    expect(r.pass, r.out).toBe(1);
  });
});

describe("dod-syntax.mjs names the form it could not read", () => {
  const cli = (args) => spawnSync("node", [path.join(REPO, "scripts/dod-syntax.mjs"), ...args], { encoding: "utf8", timeout: 60_000 });

  it("ts-has-test-case explains a forwarded callback", () => {
    const root = tree({ "f.test.ts": ["function run(f) { f(); }", "function forward(f) { run(f); }", `forward(() => it(${S}, () => {}));`, ""].join("\n") });
    const r = cli(["ts-has-test-case", path.join(root, "f.test.ts")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not counted: line 2: a callback forwarded from a parameter to another helper/);
  });

  it("ts-code-grep --test-reach explains a registration under an if", () => {
    const root = tree({ "f.test.ts": ts(`if (Math.random() > 2) { it(${S}, () => {}); }`) });
    const r = cli(["ts-code-grep", "--test-reach", "stale write", path.join(root, "f.test.ts")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no evidence from line 4: a registration inside an if statement/);
  });

  it("rust-code-grep --test-reach explains a test the host does not compile", () => {
    const root = tree({ "f.test.rs": rs("#[cfg(any())]", "#[test]", `fn t() { let _ = ${S}; }`) });
    const r = cli(["rust-code-grep", "--test-reach", "stale write", path.join(root, "f.test.rs")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no evidence from test fn t: ignored or compiled out on this host/);
  });

  it("ts-has-test-case explains a callback a helper invokes only under if", () => {
    const root = tree({ "f.test.ts": ["function run(f) { if (false) f(); }", `run(() => it(${S}, () => {}));`, ""].join("\n") });
    const r = cli(["ts-has-test-case", path.join(root, "f.test.ts")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not counted: line 2: .*not invoked in straight-line code/);
  });

  it("rust-code-grep --test-reach explains an async fn called and never awaited", () => {
    const root = tree({ "f.test.rs": rs(`async fn helper() { let _ = ${S}; }`, "#[test]", "fn t() { let _ = helper(); }") });
    const r = cli(["rust-code-grep", "--test-reach", "stale write", path.join(root, "f.test.rs")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/a call to async fn helper nothing awaits directly/);
  });

  it("rust-code-grep --test-reach explains an unused closure", () => {
    const root = tree({ "f.test.rs": rs("#[test]", `fn t() { let unused = || ${S}; }`) });
    const r = cli(["rust-code-grep", "--test-reach", "stale write", path.join(root, "f.test.rs")]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/no evidence from line 5: a closure nothing invokes directly/);
  });
});

// A witness the host cannot run: compiled only for OTHER, mounted by the crate for it.
const OTHER = HOST.os === "windows" ? "linux" : "windows";
const WHERE = { windows: "Windows CI only", linux: "Linux CI only", macos: "macOS CI only" };
const OTHER_ONLY = rs(`#[cfg(target_os = "${OTHER}")]`, "#[test]", `fn t() { let _ = ${S}; }`);
const mounted = (body, mount = "#[cfg(test)]") => ({
  "src-tauri/src/lib.rs": "pub mod a;\n",
  "src-tauri/src/a/mod.rs": `pub fn f() {}\n${mount}\n#[path = "x.test.rs"]\nmod x_tests;\n`,
  [RS_TEST]: body,
});
const forTarget = `al_test_for_target WI-X1.1 'x[.]test' 'witness' ${OTHER} 'stale write'`;

describe("al_test_for_target: a witness compiled for a named target, never executed here", () => {
  it("passes for a mounted test only that target compiles, and says this gate did not run it", () => {
    const r = call(tree(mounted(OTHER_ONLY)), forTarget);
    expect(r.pass, r.out).toBe(1);
    expect(r.fail, r.out).toBe(0);
    expect(r.out).toContain(`witness — ${OTHER} witness (compiled for ${OTHER}; NOT executed by this gate (${WHERE[OTHER]}))`);
    expect(r.out).not.toMatch(/executed by CI/);
  });

  it("the same witness still fails the host requirement", () => {
    const r = call(tree(mounted(OTHER_ONLY)), "al_test_has WI-X1.1 'x[.]test' 'host' 'stale write'");
    expect(r.fail, r.out).toBe(1);
    expect(r.pass, r.out).toBe(0);
  });

  it("fails for a test that target does not compile", () => {
    const body = rs(`#[cfg(not(target_os = "${OTHER}"))]`, "#[test]", `fn t() { let _ = ${S}; }`);
    const r = call(tree(mounted(body)), forTarget);
    expect(r.fail, r.out).toBe(1);
    expect(r.pass, r.out).toBe(0);
  });

  it.each([
    ["mounted under a cfg false for that target", mounted(OTHER_ONLY, `#[cfg(not(target_os = "${OTHER}"))]`), "compiled out on the named target"],
    ["mounted under a feature", mounted(OTHER_ONLY, '#[cfg(feature = "x")]'), "not a predicate"],
    ["not mounted at all", { [RS_TEST]: OTHER_ONLY, "src-tauri/src/lib.rs": "pub mod b;\n" }, "no live mount"],
  ])("fails for a witness file %s", (_n, files, why) => {
    const r = call(tree(files), forTarget);
    expect(r.fail, r.out).toBe(1);
    expect(r.pass, r.out).toBe(0);
    expect(r.out).toMatch(new RegExp(`is not compiled for ${OTHER}: .*${why}`));
  });

  it("rust-code-grep --target names why a host-only test is no witness for the target", () => {
    const root = tree({ "f.test.rs": rs(`#[cfg(target_os = "${HOST.os}")]`, "#[test]", `fn t() { let _ = ${S}; }`) });
    const r = spawnSync("node", [path.join(REPO, "scripts/dod-syntax.mjs"), "rust-code-grep", "--test-reach", `--target=${OTHER}`, "stale write", path.join(root, "f.test.rs")], { encoding: "utf8", timeout: 60_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(new RegExp(`test fn t: ignored or compiled out on the named target \\(${OTHER}\\)`));
  });

  it("rust-code-grep refuses an unknown target and a target without --test-reach", () => {
    const root = tree({ "f.test.rs": OTHER_ONLY });
    const run = (...a) => spawnSync("node", [path.join(REPO, "scripts/dod-syntax.mjs"), "rust-code-grep", ...a, "stale write", path.join(root, "f.test.rs")], { encoding: "utf8", timeout: 60_000 }).status;
    expect(run("--test-reach", "--target=plan9")).toBe(64);
    expect(run(`--target=${OTHER}`)).toBe(64);
    expect(run("--test-reach", `--target=${OTHER}`)).toBe(0);
  });
});
