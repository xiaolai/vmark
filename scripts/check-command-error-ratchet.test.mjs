/**
 * WI-14 — migration ratchet for `Result<T, String>` Tauri commands.
 *
 * Tests run the REAL script as a subprocess against tmpdir fixture crates —
 * no mocking. Every failure case asserts on the MESSAGE, not just the exit
 * code, so a missing or crashing script (also exit 1) cannot fake a pass.
 *
 * The counting rules are the load-bearing part: a regex that matched comments
 * would make the baseline unfalsifiable, and one that matched ordinary Rust
 * would block work that has nothing to do with the migration.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedScripts } from "./lib/packageScripts.mjs";
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-command-error-ratchet.mjs");

/** Create a fixture crate: { "foo.rs": "…" } under <root>/src-tauri/src/. */
function writeCrate(files) {
  const root = mkdtempSync(path.join(tmpdir(), "command-error-ratchet-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, "src-tauri", "src", rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  mkdirSync(path.join(root, "src-tauri", "src"), { recursive: true });
  return root;
}

function runGate(root, baseline, extraArgs = []) {
  const baselinePath = path.join(root, "baseline.json");
  writeFileSync(
    baselinePath,
    typeof baseline === "string" ? baseline : JSON.stringify(baseline, null, 2),
  );
  const res = spawnSync(
    process.execPath,
    [SCRIPT, "--root", root, "--baseline", baselinePath, ...extraArgs],
    { encoding: "utf8" },
  );
  return {
    status: res.status,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    baselinePath,
  };
}

const command = (name, ret) => `#[tauri::command]\npub fn ${name}() -> ${ret} { todo!() }\n`;

describe("check-command-error-ratchet.mjs", () => {
  it("passes when every file matches its baselined count", () => {
    const root = writeCrate({
      "a.rs": command("one", "Result<(), String>") + command("two", "Result<u8, String>"),
    });
    const { status, stdout } = runGate(root, { files: { "src-tauri/src/a.rs": 2 } });
    expect(status).toBe(0);
    expect(stdout).toContain("2");
  });

  // Case 8 — a new legacy signature must not slip in.
  it("fails when a file gained a Result<T, String> command, naming the file", () => {
    const root = writeCrate({
      "a.rs": command("one", "Result<(), String>") + command("two", "Result<u8, String>"),
    });
    const { status, stderr } = runGate(root, { files: { "src-tauri/src/a.rs": 1 } });
    expect(status).toBe(1);
    expect(stderr).toContain("src-tauri/src/a.rs");
    expect(stderr).toContain("2");
  });

  it("fails a brand-new file whose commands are not baselined at all", () => {
    const root = writeCrate({ "fresh.rs": command("one", "Result<(), String>") });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status).toBe(1);
    expect(stderr).toContain("src-tauri/src/fresh.rs");
  });

  // Case 9 — two-way: an unrecorded win becomes headroom for the next regression.
  it("fails when a file improved but the baseline was not lowered", () => {
    const root = writeCrate({ "a.rs": command("one", "Result<(), String>") });
    const { status, stderr } = runGate(root, { files: { "src-tauri/src/a.rs": 3 } });
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("record the win");
  });

  it("fails when a baselined file no longer exists", () => {
    const root = writeCrate({ "a.rs": command("one", "Result<(), String>") });
    const { status, stderr } = runGate(root, {
      files: { "src-tauri/src/a.rs": 1, "src-tauri/src/gone.rs": 2 },
    });
    expect(status).toBe(1);
    expect(stderr).toContain("src-tauri/src/gone.rs");
  });

  // Case 10 — ordinary Rust must not be blocked.
  it("does not count a plain fn returning Result<T, String>", () => {
    const root = writeCrate({
      "a.rs": `pub fn helper() -> Result<(), String> { Ok(()) }\nfn other() -> Result<u8, String> { Ok(1) }\n`,
    });
    const { status } = runGate(root, { files: {} });
    expect(status).toBe(0);
  });

  it("does not count a command already returning CommandError", () => {
    const root = writeCrate({
      "a.rs": command("done", "Result<(), CommandError>") + command("done2", "Result<Vec<u8>, crate::command_error::CommandError>"),
    });
    const { status } = runGate(root, { files: {} });
    expect(status).toBe(0);
  });

  it("counts a signature split across lines with a generic Ok type", () => {
    const root = writeCrate({
      "a.rs": `#[tauri::command]\npub async fn wide(\n    app: AppHandle,\n    paths: Vec<String>,\n) -> Result<\n    Vec<PendingFileOpen>,\n    String,\n> {\n    todo!()\n}\n`,
    });
    const { status } = runGate(root, { files: { "src-tauri/src/a.rs": 1 } });
    expect(status).toBe(0);
  });

  it("counts a command carrying extra attributes and a lifetime parameter", () => {
    const root = writeCrate({
      "a.rs": `#[tauri::command]\n#[allow(clippy::too_many_arguments)]\npub async fn held(state: State<'_, Surface>) -> Result<(), String> { todo!() }\n`,
    });
    const { status } = runGate(root, { files: { "src-tauri/src/a.rs": 1 } });
    expect(status).toBe(0);
  });

  // ── Attribute shapes the exact-string match could not see (finding 10) ──
  // `COMMAND_ATTRIBUTE` was the literal "#[tauri::command]", so every
  // parameterized form of the attribute was invisible and the command it
  // decorates never entered the count.
  it.each([
    ['rename_all', `#[tauri::command(rename_all = "snake_case")]`],
    ["async_runtime", `#[tauri::command(async)]`],
    ["a nested paren argument", `#[tauri::command(rename_all = "camelCase", async)]`],
    ["inner whitespace", `#[ tauri :: command ]`],
  ])("counts a command whose attribute carries %s", (_label, attr) => {
    const root = writeCrate({
      "a.rs": `${attr}\npub fn one() -> Result<(), String> { todo!() }\n`,
    });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status, stderr).toBe(1);
    expect(stderr).toContain("src-tauri/src/a.rs");
  });

  it("does not confuse a different tauri:: attribute for a command", () => {
    const root = writeCrate({
      "a.rs": `#[tauri::command_bogus]\npub fn one() -> Result<(), String> { todo!() }\n`,
    });
    expect(runGate(root, { files: {} }).status).toBe(0);
  });

  // ── Qualified type paths (finding 11) ──
  it.each([
    ["std::result::Result", `std::result::Result<(), String>`],
    ["::std::result::Result", `::std::result::Result<(), String>`],
    ["core::result::Result", `core::result::Result<(), String>`],
    ["a qualified String", `Result<(), std::string::String>`],
    ["both qualified", `::core::result::Result<Vec<u8>, ::std::string::String>`],
  ])("counts a command returning %s", (_label, ret) => {
    const root = writeCrate({ "a.rs": command("one", ret) });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status, stderr).toBe(1);
    expect(stderr).toContain("src-tauri/src/a.rs");
  });

  it("does not count a two-parameter Result whose error type merely ends in String", () => {
    const root = writeCrate({ "a.rs": command("one", "Result<(), MyString>") });
    expect(runGate(root, { files: {} }).status).toBe(0);
  });

  it.each([
    ["a line comment", `// #[tauri::command]\n// pub fn ghost() -> Result<(), String> {}\n`],
    [
      "a block comment",
      `/*\n#[tauri::command]\npub fn ghost() -> Result<(), String> { todo!() }\n*/\n`,
    ],
    [
      "a doc comment",
      `/// #[tauri::command]\n/// pub fn ghost() -> Result<(), String> {}\npub struct X;\n`,
    ],
    [
      "a nested block comment",
      `/* outer /* inner\n#[tauri::command]\npub fn ghost() -> Result<(), String> {}\n*/ still commented */\n`,
    ],
    [
      "a string literal",
      `pub const SAMPLE: &str = "#[tauri::command] pub fn ghost() -> Result<(), String> {}";\n`,
    ],
    [
      "a raw string literal",
      `pub const SAMPLE: &str = r#"#[tauri::command] pub fn ghost() -> Result<(), String> {}"#;\n`,
    ],
  ])("does not count a command inside %s", (_label, source) => {
    const root = writeCrate({ "a.rs": source });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status, stderr).toBe(0);
  });

  it("still counts real commands in a file that also contains comments and strings", () => {
    const root = writeCrate({
      "a.rs":
        `// #[tauri::command] pub fn ghost() -> Result<(), String> {}\n` +
        `const URL: &str = "http://example.com/// not a comment";\n` +
        `const CH: char = '"';\n` +
        command("real", "Result<(), String>"),
    });
    const { status, stderr } = runGate(root, { files: { "src-tauri/src/a.rs": 1 } });
    expect(status, stderr).toBe(0);
  });

  it("scans nested module directories", () => {
    const root = writeCrate({
      "browser/mod.rs": command("nested", "Result<(), String>"),
    });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status).toBe(1);
    expect(stderr).toContain("src-tauri/src/browser/mod.rs");
  });

  it("ignores *.test.rs files — test helpers are not the shipped surface", () => {
    const root = writeCrate({
      "a.test.rs": command("fixture", "Result<(), String>"),
    });
    const { status } = runGate(root, { files: {} });
    expect(status).toBe(0);
  });

  it.each([
    ["truncated JSON", '{"files": {'],
    ["a JSON array", "[]"],
    ["a missing files object", '{"note": "hi"}'],
    ["a non-integer count", '{"files": {"src-tauri/src/a.rs": "two"}}'],
    ["a negative count", '{"files": {"src-tauri/src/a.rs": -1}}'],
  ])("fails closed on %s", (_label, baseline) => {
    const root = writeCrate({ "a.rs": command("one", "Result<(), String>") });
    const { status, stderr } = runGate(root, baseline);
    expect(status).toBe(1);
    expect(stderr.toLowerCase()).toContain("baseline");
  });

  it("writes the current counts with --write-baseline", () => {
    const root = writeCrate({
      "a.rs": command("one", "Result<(), String>") + command("two", "Result<u8, String>"),
      "b.rs": command("three", "Result<(), CommandError>"),
    });
    const { status, baselinePath } = runGate(root, { files: {} }, ["--write-baseline"]);
    expect(status).toBe(0);
    const written = JSON.parse(readFileSync(baselinePath, "utf8"));
    expect(written.files).toEqual({ "src-tauri/src/a.rs": 2 });
  });

  it("passes on an empty crate with an empty baseline", () => {
    const root = writeCrate({});
    const { status } = runGate(root, { files: {} });
    expect(status).toBe(0);
  });

  it("rejects an unknown argument instead of silently ignoring it", () => {
    const res = spawnSync(process.execPath, [SCRIPT, "--nope"], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("--nope");
  });
});

describe("wiring — real package.json", () => {
  // A perfectly tested checker nobody runs is the mutation-workflow death
  // class: green tests, zero enforcement.
  it("exposes lint:command-errors and chains it into check:all", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(pkg.scripts["lint:command-errors"]).toContain("check-command-error-ratchet.mjs");
    // Transitive: check:all composes check:static/servers/build, so a
    // literal substring check would break on regrouping (see
    // scripts/lib/packageScripts.mjs).
    expect(invokedScripts(pkg.scripts, "check:all")).toContain("lint:command-errors");
  });
});

describe("the real repository tree", () => {
  it("holds its committed baseline", () => {
    const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", cwd: REPO });
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
  });

  it("counts the migrated modules as zero — the ratchet has real movement to show", () => {
    const baseline = JSON.parse(
      readFileSync(path.join(REPO, "scripts", "command-error-baseline.json"), "utf8"),
    );
    expect(baseline.files["src-tauri/src/file_write.rs"]).toBeUndefined();
    expect(baseline.files["src-tauri/src/browser/ai_commands.rs"]).toBeUndefined();
    expect(Object.keys(baseline.files).length).toBeGreaterThan(0);
  });
});
