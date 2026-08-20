/**
 * Self-test for the window-creation threading gate.
 *
 * Runs the REAL script as a subprocess against tmpdir fixture crates. Every
 * failure case asserts on the MESSAGE, not just the exit code — a crashed or
 * missing script also exits non-zero, and a test that reads only the code
 * cannot tell that apart from the gate working.
 *
 * WHY THE PROPERTY MATTERS. #1301/#1302: opening Settings from the status bar
 * froze VMark on Windows 11 and left a process that survived Task Manager.
 * `open_settings_window` was a plain `#[tauri::command]`, so Tauri ran it
 * inline on the thread delivering the IPC message — inside WebView2's
 * `WebMessageReceived` COM callback — and building a webview there is the
 * reentrancy deadlock WebView2 forbids. Seven commands in this crate had it.
 * There is NO macOS symptom, so no other gate here and no maintainer's local
 * run could have seen it.
 *
 * REGRESSION PINS, all of them mistakes made while writing the gate:
 *   - visibility-aware reachability. Resolving calls by bare name reported 15
 *     findings against the real crate, 8 of them false, because the seed set
 *     holds two private helpers named `start` and two named `start_print`, and
 *     those names are written all over the crate. A
 *     private `fn` is callable only from its own module, i.e. its own file;
 *     with that rule the same scan reports 7, all real.
 *   - comments are stripped before matching. This crate's module docs name
 *     `#[tauri::command]` and `WebviewWindowBuilder::new` in prose — including
 *     the very header added for this fix — and reading prose as code is the
 *     false positive `check-ipc-contract.mjs` already records paying for.
 *   - a bare `// window-thread-ok` with no reason is rejected. An unexplained
 *     opt-out is a mute button.
 *   - an empty seed set fails loudly rather than passing. If the builder is
 *     ever renamed, a gate that finds nothing to check must say so instead of
 *     reporting green forever.
 *
 * @coordinates-with scripts/check-window-creation-thread.mjs
 * @coordinates-with src-tauri/src/window_manager/mod.rs — the documented reason
 * @module scripts/check-window-creation-thread.test
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { invokedScripts } from "./lib/packageScripts.mjs";
import pkg from "../package.json" with { type: "json" };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(REPO, "scripts", "check-window-creation-thread.mjs");

/** Build a fixture crate: { "src-tauri/src/a.rs": "..." } */
function writeTree(files) {
  const dir = mkdtempSync(path.join(tmpdir(), "window-thread-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
}

function run(cwd) {
  const r = spawnSync(process.execPath, [SCRIPT], { cwd, encoding: "utf8" });
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** A module that actually builds a window. */
const BUILDER = (fnName = "build_it", vis = "pub ") =>
  `${vis}fn ${fnName}(app: &AppHandle) -> Result<(), tauri::Error> {\n` +
  `    let _w = WebviewWindowBuilder::new(app, "x", WebviewUrl::App("/".into())).build()?;\n` +
  `    Ok(())\n}\n`;

describe("check-window-creation-thread", () => {
  it("passes when the window-creating command is async", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\n#[tauri::command(async)]\npub fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  it("passes when the command is an `async fn`", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\n#[tauri::command]\npub async fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n`,
    });
    const { code } = run(dir);
    expect(code).toBe(0);
  });

  it("fails a synchronous command that creates a window directly", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `#[tauri::command]\npub fn open_thing(app: AppHandle) -> Result<(), tauri::Error> {\n    let _w = WebviewWindowBuilder::new(&app, "x", WebviewUrl::App("/".into())).build()?;\n    Ok(())\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("deadlocks on Windows");
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  it("fails a synchronous command that creates a window through a chain of helpers", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\npub fn middle(app: &AppHandle) {\n    let _ = build_it(app);\n}\n`,
      "src-tauri/src/cmd.rs": `#[tauri::command]\npub fn open_thing(app: AppHandle) {\n    middle(&app);\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  it("does NOT charge a command for a same-named PRIVATE helper in another file", () => {
    // The real false-positive: `pdf_export::renderer::windows::start` builds a
    // window and is private, while `start(` is written in modules that have
    // nothing to do with windows. Bare-name reachability called all of them
    // window creators.
    const dir = writeTree({
      "src-tauri/src/render.rs": BUILDER("start", ""),
      "src-tauri/src/unrelated.rs": `fn start(x: u32) -> u32 {\n    x + 1\n}\n\n#[tauri::command]\npub fn tick() -> u32 {\n    start(1)\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  it("still follows a PUBLIC helper across files", () => {
    const dir = writeTree({
      "src-tauri/src/render.rs": BUILDER("start", "pub "),
      "src-tauri/src/cmd.rs": `#[tauri::command]\npub fn tick(app: AppHandle) {\n    let _ = start(&app);\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("tick");
    expect(code).toBe(1);
  });

  it("reads prose as prose: an attribute named in a doc comment is not a command", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `//! This module explains that #[tauri::command] must be async when it calls\n` +
        `//! WebviewWindowBuilder::new, because Windows deadlocks otherwise.\n` +
        `fn helper() {}\n`,
    });
    const { code, err } = run(dir);
    // The seed is empty once comments are stripped, so the gate must report
    // "the primitive moved" — never a silent pass, and never a phantom finding.
    expect(err).toContain("window-creation primitive moved");
    expect(code).toBe(64);
  });

  it("accepts an opt-out with a reason", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\n#[tauri::command]\npub fn open_later(app: AppHandle) {\n    // window-thread-ok: creation is handed to a spawned task, off the main thread.\n    tauri::async_runtime::spawn(async move { let _ = build_it(&app); });\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  it("rejects a bare opt-out with no reason", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\n#[tauri::command]\npub fn open_later(app: AppHandle) {\n    // window-thread-ok\n    let _ = build_it(&app);\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("no reason");
    expect(code).toBe(1);
  });

  it("ignores Rust test files, which never ship", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": BUILDER(),
      "src-tauri/src/w.test.rs": `#[tauri::command]\npub fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n`,
    });
    const { code } = run(dir);
    expect(code).toBe(0);
  });

  it("refuses to pass vacuously when there are no Rust sources", () => {
    const dir = writeTree({ "README.md": "no rust here\n" });
    const { code, err } = run(dir);
    expect(err).toContain("refusing to pass vacuously");
    expect(code).toBe(64);
  });

  it("is wired into check:static, so CI's required check runs it", () => {
    expect(invokedScripts(pkg.scripts, "check:static")).toContain("lint:window-thread");
  });

  it("holds against the real crate", () => {
    const { code, out } = run(REPO);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });
});
