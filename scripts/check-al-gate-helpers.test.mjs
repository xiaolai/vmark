// WI-AL0.7 — the agent-edit-ledger gate helpers judge test and production CODE, not comments
/**
 * Sources the REAL `scripts/lib/al-gate.sh` (after `dod-assertions.sh`, the
 * order the gates use) inside a fixture tree and calls one helper per case,
 * reading the ✓/✗ line it prints. Each helper is held to the same contract:
 * a scenario or symbol named only in a COMMENT — the work-item header line, a
 * note, a commented-out call — proves nothing and fails; the same text in
 * code (a test title, a call, a declaration) passes.
 *
 * @coordinates-with scripts/lib/al-gate.sh — al_tests_cover, al_test_has, al_code_has
 * @coordinates-with scripts/dod-syntax.mjs — the ts-code-grep / rust-code-grep probes they call
 * @module scripts/check-al-gate-helpers.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A fixture tree holding `files` ({ relPath: body }). */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "al-gate-helpers-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

/** Run one helper call in `root`; returns its exit status and output. */
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
const tsTest = (title, comment = "") => `// WI-X1.1 — header\n// ${comment}\nimport { it } from "vitest";\nit(${JSON.stringify(title)}, () => {});\n`;

describe("al_tests_cover", () => {
  it.each([
    ["a scenario in a test title passes", tsTest("refuses a stale write"), 1],
    ["a scenario only in a comment fails", tsTest("pins", "stale write"), 0],
  ])("%s", (_name, body, pass) => {
    const r = call(tree({ [TS_TEST]: body }), "al_tests_cover WI-X1.1 'stale' 'covers stale'");
    expect(r.pass, r.out).toBe(pass);
    expect(r.fail, r.out).toBe(1 - pass);
  });

  it("the work-item header line itself is a comment and covers nothing", () => {
    const r = call(tree({ [TS_TEST]: tsTest("pins") }), "al_tests_cover WI-X1.1 'header' 'covers header'");
    expect(r.fail, r.out).toBe(1);
  });

  it("matches case-insensitively", () => {
    const r = call(tree({ [TS_TEST]: tsTest("handles CJK text") }), "al_tests_cover WI-X1.1 'cjk' 'covers cjk'");
    expect(r.pass, r.out).toBe(1);
  });

  it.each([
    ["a scenario in a Rust test name passes", "// WI-X1.1 — header\n#[test]\nfn refuses_stale() {}\n", 1],
    ["a scenario only in a Rust comment fails", "// WI-X1.1 — header\n// stale\n#[test]\nfn pins() {}\n", 0],
  ])("%s", (_name, body, pass) => {
    const r = call(tree({ [RS_TEST]: body }), "al_tests_cover WI-X1.1 'stale' 'covers stale'");
    expect(r.pass, r.out).toBe(pass);
  });

  it("a .mjs gate test is read as JavaScript", () => {
    const r = call(tree({ "scripts/x.test.mjs": tsTest("stale tree") }), "al_tests_cover WI-X1.1 'stale' 'covers stale'");
    expect(r.pass, r.out).toBe(1);
  });
});

describe("al_tests_cover counts only code a runnable test case reaches", () => {
  const head = '// WI-X1.1 — header\nimport { describe, expect, it } from "vitest";\n';
  it.each([
    ["an unused string beside an unrelated passing test fails", `${head}const unused = "stale write";\nit("pins", () => {});\n`, 0],
    ["an unused helper whose name says it fails", `${head}function staleHelper() {}\nit("pins", () => {});\n`, 0],
    ["a string only in a skipped case fails", `${head}it.skip("stale write", () => {});\nit("pins", () => {});\n`, 0],
    ["a string in a title with no handler fails", `${head}it("stale write");\nit("pins", () => {});\n`, 0],
    ["a fixture a case uses passes", `${head}const FIXTURE = "stale write";\nit("pins", () => { expect(FIXTURE).toBeTruthy(); });\n`, 1],
    ["a fixture reached through a helper a case calls passes", `${head}const FIXTURE = "stale write";\nconst make = () => FIXTURE;\nit("pins", () => { make(); });\n`, 1],
    ["a describe title over a runnable case passes", `${head}describe("stale writes", () => { it("pins", () => {}); });\n`, 1],
    ["a describe title over no runnable case fails", `${head}describe("stale writes", () => {});\nit("pins", () => {});\n`, 0],
    ["a scenario in an it.each table passes", `${head}it.each([["stale"]])("pins %s", () => {});\n`, 1],
  ])("TS: %s", (_name, body, pass) => {
    const r = call(tree({ [TS_TEST]: body }), "al_tests_cover WI-X1.1 'stale' 'covers stale'");
    expect(r.pass, r.out).toBe(pass);
    expect(r.fail, r.out).toBe(1 - pass);
  });

  const rsHead = "// WI-X1.1 — header\n";
  it.each([
    ["an unused const string beside an unrelated passing test fails", `${rsHead}const UNUSED: &str = "stale";\n#[test]\nfn pins() {}\n`, 0],
    ["an unused helper whose name says it fails", `${rsHead}fn stale_helper() {}\n#[test]\nfn pins() {}\n`, 0],
    ["a string in a non-test fn nothing calls fails", `${rsHead}fn other() -> &'static str { "stale" }\n#[test]\nfn pins() {}\n`, 0],
    ["a string in a test body passes", `${rsHead}#[test]\nfn pins() {\n    assert_eq!("stale", "stale");\n}\n`, 1],
    ["a const a test uses passes", `${rsHead}const FIXTURE: &str = "stale";\n#[tokio::test(flavor = "multi_thread")]\nasync fn pins() {\n    assert!(!FIXTURE.is_empty());\n}\n`, 1],
    ["a helper a test calls passes", `${rsHead}fn fixture() -> &'static str {\n    "stale"\n}\n#[test]\nfn pins() {\n    fixture();\n}\n`, 1],
  ])("Rust: %s", (_name, body, pass) => {
    const r = call(tree({ [RS_TEST]: body }), "al_tests_cover WI-X1.1 'stale' 'covers stale'");
    expect(r.pass, r.out).toBe(pass);
    expect(r.fail, r.out).toBe(1 - pass);
  });

  it("al_test_has fails when one scenario is only an unused string", () => {
    const body = '// WI-X1.1 — header\nimport { it } from "vitest";\nconst unused = "emoji";\nit("CJK", () => {});\n';
    const r = call(tree({ [TS_TEST]: body }), "al_test_has WI-X1.1 '.' 'both' 'cjk' 'emoji'");
    expect(r.fail, r.out).toBe(1);
  });
});

describe("al_test_has", () => {
  it("passes when one test names every scenario in code", () => {
    const r = call(tree({ [TS_TEST]: tsTest("CJK and emoji") }), "al_test_has WI-X1.1 '.' 'both' 'cjk' 'emoji'");
    expect(r.pass, r.out).toBe(1);
  });

  it("fails when one of the scenarios is only in a comment", () => {
    const r = call(tree({ [TS_TEST]: tsTest("CJK", "emoji") }), "al_test_has WI-X1.1 '.' 'both' 'cjk' 'emoji'");
    expect(r.fail, r.out).toBe(1);
  });
});

describe("al_code_has", () => {
  it.each([
    ["a TS declaration passes", { "src/s/a.ts": "export class ViewCertificate {}\n" }, 1],
    ["a TS comment fails", { "src/s/a.ts": "// class ViewCertificate is planned\nexport {};\n" }, 0],
    ["a commented-out TS call fails", { "src/s/a.ts": "// build_command(x);\nexport {};\n" }, 0],
    ["a Rust fn passes", { "src/s/a.rs": "pub fn build_command() {}\n" }, 1],
    ["a Rust doc comment fails", { "src/s/a.rs": "/// uses build_command\npub fn other() {}\n" }, 0],
    ["a TS string literal alone fails", { "src/s/a.ts": 'export const s = "build_command";\n' }, 0],
    ["a match only in a test file fails", { "src/s/a.test.ts": "export function build_command() {}\n" }, 0],
  ])("%s", (_name, files, pass) => {
    const re = Object.values(files)[0].includes("ViewCertificate") ? "class ViewCertificate" : "build_command";
    const r = call(tree(files), `al_code_has '${re}' src/s 'symbol in code'`);
    expect(r.pass, r.out).toBe(pass);
    expect(r.fail, r.out).toBe(1 - pass);
  });

  it("--keep-strings counts a literal subject, still not a comment", () => {
    const lit = call(tree({ "src/s/a.rs": 'const P: &str = "vmark-journal/";\n' }), "al_code_has 'vmark-journal/' src/s 'branch' --keep-strings");
    expect(lit.pass, lit.out).toBe(1);
    const note = call(tree({ "src/s/a.rs": "// vmark-journal/\nconst P: u8 = 1;\n" }), "al_code_has 'vmark-journal/' src/s 'branch' --keep-strings");
    expect(note.fail, note.out).toBe(1);
  });

  it("fails on a missing directory", () => {
    const r = call(tree({}), "al_code_has 'x' src/none 'symbol in code'");
    expect(r.fail, r.out).toBe(1);
    expect(r.out).toMatch(/directory missing/);
  });
});

describe("al-gate.sh scratch files", () => {
  it("an unwritable TMPDIR stops the gate at setup with one clear diagnostic", () => {
    const root = tree({});
    const script = [
      "set -uo pipefail",
      `cd ${JSON.stringify(root)} || exit 99`,
      "EXEC=0",
      `source ${JSON.stringify(path.join(REPO, "scripts/lib/al-gate.sh"))}`,
      'echo "SOURCED"',
    ].join("\n");
    const r = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      timeout: 60_000,
      killSignal: "SIGKILL",
      env: { ...process.env, TMPDIR: path.join(root, "no-such-dir") },
    });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status, out).not.toBe(0);
    expect(out).not.toMatch(/SOURCED/);
    expect(out).toMatch(/al-gate: cannot create a scratch directory/);
  });
});

describe("al_rust_filter names the module a Rust test is compiled under", () => {
  const filter = (files, test) => {
    const r = call(tree(files), `if al_rust_filter ${JSON.stringify(test)}; then echo "FILTER[$_AL_FILTER]"; else echo "FILTER-NONE"; fi`);
    return /FILTER\[([^\]]*)\]|FILTER-NONE/.exec(r.out)?.[1] ?? null;
  };
  const mountTest = (name) => `#[cfg(test)]\n#[path = "${name}"]\nmod tests;\n`;
  it.each([
    ["a file mounted by its own name", { "src-tauri/src/a/mod.rs": "mod b;\n", "src-tauri/src/a/b.rs": mountTest("x.test.rs") }, "a::b::"],
    ["a mod.rs owner is its directory", { "src-tauri/src/a/mod.rs": mountTest("x.test.rs") }, "a::"],
    ["the crate root runs the whole crate", { "src-tauri/src/lib.rs": mountTest("x.test.rs") }, "", "src-tauri/src/x.test.rs"],
    ["an owner renamed by #[path] takes the name it is mounted under",
      { "src-tauri/src/a/mod.rs": "mod w;\n", "src-tauri/src/a/w.rs": '#[path = "w_replay.rs"]\nmod replay;\n', "src-tauri/src/a/w_replay.rs": mountTest("x.test.rs") },
      "a::w::replay::"],
    ["a rename two levels deep resolves through both",
      { "src-tauri/src/a/w.rs": '#[path = "w_r.rs"]\npub(crate) mod r;\n', "src-tauri/src/a/w_r.rs": '#[path = "w_r_s.rs"]\nmod s;\n', "src-tauri/src/a/w_r_s.rs": mountTest("x.test.rs") },
      "a::w::r::s::"],
    ["a commented-out #[path] renames nothing",
      { "src-tauri/src/a/w.rs": '// #[path = "w_replay.rs"]\n// mod replay;\n', "src-tauri/src/a/w_replay.rs": mountTest("x.test.rs") },
      "a::w_replay::"],
  ])("%s", (_, files, want, test = "src-tauri/src/a/x.test.rs") => {
    expect(filter(files, test)).toBe(want);
  });
  it("an unmounted test file has no filter", () => {
    expect(filter({ "src-tauri/src/a/mod.rs": "\n" }, "src-tauri/src/a/x.test.rs")).toBeNull();
  });
});
