/**
 * Self-test for the cross-language IPC contract gate.
 *
 * Runs the REAL script as a subprocess against tmpdir fixture trees. Every
 * failure case asserts on the MESSAGE, not just the exit code: a crashing or
 * missing script also exits non-zero, and a test that only reads the code
 * cannot tell those apart from the gate working.
 *
 * The doc-comment case below is a REGRESSION PIN, not a hypothetical. The first
 * run of this gate against the real repo reported `session_gone` in
 * `src-tauri/src/pty.rs` as an unregistered command. It is a private helper;
 * what the scan actually matched was the string `#[tauri::command]` inside a
 * `//!` module doc comment, which it then bound to the next `fn` in the file.
 * The fix (strip comments, anchor the attribute to line start) is invisible
 * without this test, and the failure it prevents looks exactly like a real
 * finding — which is the expensive kind.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedScripts } from "./lib/packageScripts.mjs";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-ipc-contract.mjs");

/** Build a fixture repo: { "src/a.ts": "...", "src-tauri/src/b.rs": "..." } */
function writeTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "ipc-contract-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function run(cwd, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

const registry = (names) =>
  `pub fn registry() {\n    tauri::generate_handler![\n${names.map((n) => `        ${n}`).join(",\n")}\n    ]\n}\n`;

describe("check-ipc-contract", () => {
  it("passes when every invoked command exists and every command is registered", () => {
    const dir = writeTree({
      "src/a.ts": `import { invoke } from "@tauri-apps/api/core";\nawait invoke("do_thing");\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn do_thing() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::do_thing"]),
    });
    const { code, out } = run(dir);
    expect(out).toContain("IPC contract OK");
    expect(code).toBe(0);
  });

  it("fails when TS invokes a command with no Rust definition", () => {
    const dir = writeTree({
      "src/a.ts": `import { invoke } from "@tauri-apps/api/core";\nawait invoke("ghost_command");\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn do_thing() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::do_thing"]),
    });
    const { code, err } = run(dir);
    expect(err).toContain('invoke("ghost_command") has no #[command] fn');
    expect(err).toContain("src/a.ts:2");
    expect(code).toBe(1);
  });

  it("fails when a Rust command is not in generate_handler!", () => {
    const dir = writeTree({
      "src/a.ts": `import { invoke } from "@tauri-apps/api/core";\nawait invoke("do_thing");\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn do_thing() {}\n\n#[tauri::command]\npub fn forgotten() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::do_thing"]),
    });
    const { code, err } = run(dir);
    expect(err).toContain("#[command] fn forgotten is not in generate_handler!");
    expect(code).toBe(1);
  });

  it("does NOT treat an attribute mentioned inside a doc comment as a command", () => {
    // The exact shape of src-tauri/src/pty.rs, which this gate falsely
    // flagged on its first real run.
    const dir = writeTree({
      "src/a.ts": `import { invoke } from "@tauri-apps/api/core";\nawait invoke("real_cmd");\n`,
      "src-tauri/src/pty.rs":
        `//! @coordinates-with reader.rs — registered as \`pty::reader::start\`\n` +
        `//!   because \`#[tauri::command]\` generates a sibling macro that a\n` +
        `//!   function-only re-export does not carry\n\n` +
        `/* a block comment also naming #[command] for good measure */\n\n` +
        `fn session_gone(pid: u32) -> Error { Error::not_found(pid) }\n\n` +
        `#[tauri::command]\npub fn real_cmd() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["pty::real_cmd"]),
    });
    const { code, out, err } = run(dir, ["--report"]);
    expect(err).not.toContain("session_gone");
    expect(out).not.toContain("session_gone");
    expect(out).toContain("Rust #[command] fns          : 1");
    expect(code).toBe(0);
  });

  it("matches the imported short form #[command], not only #[tauri::command]", () => {
    // Matching only the qualified spelling reported 17 phantom findings.
    const dir = writeTree({
      "src/a.ts": `import { invoke } from "@tauri-apps/api/core";\nawait invoke("short_form");\n`,
      "src-tauri/src/cmds.rs": `use tauri::command;\n\n#[command]\npub async fn short_form() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::short_form"]),
    });
    const { code, out } = run(dir);
    expect(out).toContain("IPC contract OK");
    expect(code).toBe(0);
  });

  it("sees invoke() calls that carry type arguments", () => {
    // `invoke<Record<string, unknown>>(...)` — the nested-generic form that a
    // textual scan and `ast-grep -p 'invoke($$$)'` both miss.
    const dir = writeTree({
      "src/a.ts":
        `import { invoke } from "@tauri-apps/api/core";\n` +
        `await invoke<Record<string, unknown>>("generic_cmd");\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn other() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::other"]),
    });
    const { code, err } = run(dir);
    expect(err).toContain('invoke("generic_cmd") has no #[command] fn');
    expect(code).toBe(1);
  });

  it("resolves a command name held in a const or a const map", () => {
    const dir = writeTree({
      "src/a.ts":
        `import { invoke } from "@tauri-apps/api/core";\n` +
        `const CMD = "from_const";\n` +
        `const MAP = { CAPTURE: "from_map" } as const;\n` +
        `await invoke(CMD);\n` +
        `await invoke(MAP.CAPTURE);\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn from_const() {}\n`,
      "src-tauri/src/command_registry.rs": registry(["cmds::from_const"]),
    });
    const { code, err } = run(dir);
    expect(err).toContain('invoke("from_map") has no #[command] fn');
    expect(code).toBe(1);
  });

  it("refuses to pass vacuously when there are no Rust sources", () => {
    const dir = writeTree({ "src/a.ts": `export const x = 1;\n` });
    const { code, err } = run(dir);
    expect(err).toContain("no Rust sources found");
    expect(code).toBe(64);
  });

  it("refuses to pass when generate_handler! cannot be parsed", () => {
    const dir = writeTree({
      "src/a.ts": `export const x = 1;\n`,
      "src-tauri/src/cmds.rs": `#[tauri::command]\npub fn do_thing() {}\n`,
      "src-tauri/src/command_registry.rs": `pub fn registry() { /* moved elsewhere */ }\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("could not parse generate_handler!");
    expect(code).toBe(64);
  });

  it("is wired into check:all", () => {
    const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
    expect(invokedScripts(pkg.scripts, "check:all")).toContain("lint:ipc-contract");
  });

  it("passes against the real repository", () => {
    const { code, out } = run(REPO);
    expect(out).toContain("IPC contract OK");
    expect(code).toBe(0);
  });
});
