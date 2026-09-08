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
 *   - a receiver call is not an edge ACROSS files. `x.settle(...)` says which
 *     VALUE is being asked, not which type's method answers, and this scan does
 *     not know types. One `pub(super) fn settle` in `pdf_export::renderer::sink`
 *     and one `owned.settle(...)` in `browser::nav_kvo_macos` were read as the
 *     same call, and seven window-less commands were reported as window
 *     creators — whose "fix" would have been making seven unrelated commands
 *     async, a hazard of its own. Path-qualified and free calls still count.
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

  it("does NOT charge a command for a same-named METHOD on another type", () => {
    // The second false-positive class, live on 2026-09-07: `pdf_export::
    // renderer::sink` gained `pub(super) fn settle` (which reaches a window
    // builder), while `browser::nav_kvo_macos` calls `owned.settle(...)` on
    // something else entirely. Matched with `\b`, those two were ONE edge, and
    // through it SEVEN commands that touch no window — `read_workspace_config`,
    // `update_recent_files`, `mcp_config_install` … — became "window creators".
    // A receiver decides which type's method runs, and this scan does not know
    // types, so a receiver call is not an edge ACROSS files.
    const dir = writeTree({
      "src-tauri/src/render.rs": `struct Sink;\nimpl Sink {\n${BUILDER("settle", "    pub(super) ")}}\n`,
      "src-tauri/src/unrelated.rs":
        `#[tauri::command]\npub fn save_config(owned: Other) {\n    owned.settle(1);\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  it("still follows a receiver call WITHIN one file", () => {
    // Same file, so both definitions are in front of the author and a name
    // collision is not the failure mode: the edge stays.
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `struct Sink;\nimpl Sink {\n${BUILDER("settle", "    ")}}\n` +
        `#[tauri::command]\npub fn open_thing(s: Sink) {\n    s.settle();\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  it("still follows a PATH-QUALIFIED call across files", () => {
    // `::` is not a receiver, so the cross-file rule leaves it alone.
    const dir = writeTree({
      "src-tauri/src/render.rs": BUILDER("start", "pub "),
      "src-tauri/src/cmd.rs":
        `#[tauri::command]\npub fn tick(app: AppHandle) {\n    let _ = crate::render::start(&app);\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("tick");
    expect(code).toBe(1);
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

  // audit R2 #104 — the local lexer kept string CONTENTS, so a `}` inside an
  // ordinary string closed the body early and every call edge after it vanished.
  it("does not let a brace inside a string literal truncate a function body", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        'pub fn build_it(app: &AppHandle) -> Result<(), tauri::Error> {\n' +
        '    let _msg = "closing } brace";\n' +
        '    let _raw = r#"a "quoted" } brace"#;\n' +
        "    let _ch = '}';\n" +
        '    let _w = WebviewWindowBuilder::new(app, "x", WebviewUrl::App("/".into())).build()?;\n' +
        "    Ok(())\n}\n" +
        "#[tauri::command]\npub fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n",
    });
    const r = run(dir);
    expect(r.code, r.out + r.err).toBe(1);
    expect(r.err).toContain("open_thing");
  });

  // audit R2 #109 — the marker was read out of RAW source, so a string
  // containing it silenced a real violation.
  it("does not accept an opt-out marker that lives inside a string literal", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `${BUILDER()}\n#[tauri::command]\npub fn open_thing(app: AppHandle) {\n` +
        '    let _doc = "// window-thread-ok: not really a comment";\n' +
        "    let _ = build_it(&app);\n}\n",
    });
    const r = run(dir);
    expect(r.code, r.out + r.err).toBe(1);
    expect(r.err).toContain("open_thing");
  });

  // audit R2 #103 — a bodyless declaration used to swallow the NEXT item's
  // body, so a phantom fn carried call edges that were not its own.
  it("does not give a bodyless trait method another item's body", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `${BUILDER()}\npub trait Opener {\n    fn build_it(&self, app: &AppHandle);\n}\n` +
        "#[tauri::command]\npub fn harmless(_app: AppHandle) {\n    let _ = 1;\n}\n",
    });
    const r = run(dir);
    expect(r.code, r.out + r.err).toBe(0);
  });

  // audit R2 #107 — identity was `file::name`, so a PRIVATE reaching helper and
  // a PUBLIC harmless one sharing a name in one file were one entry: marking
  // the private one reachable marked the public one too, and a command in
  // another file that calls the public one was charged for a window it cannot
  // reach. (Within ONE file any spelling still counts — that is the documented
  // trade in this file's header.)
  it("does not charge a cross-file caller for a same-named private helper", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        "mod inner {\n" +
        "    use super::*;\n" +
        "    fn start(app: &AppHandle) -> Result<(), tauri::Error> {\n" +
        '        let _w = WebviewWindowBuilder::new(app, "x", WebviewUrl::App("/".into())).build()?;\n' +
        "        Ok(())\n    }\n}\n" +
        "pub fn start(_n: u8) -> u8 {\n    7\n}\n",
      "src-tauri/src/other.rs":
        "#[tauri::command]\npub fn count_thing() -> u8 {\n    start(1)\n}\n",
    });
    const r = run(dir);
    expect(r.code, r.out + r.err).toBe(0);
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

  // A closure PARAMETER (or a `let`) shadows a crate item of the same name for
  // the whole body, so a bare call on it is the binding, not the item. This
  // fired for real on 2026-09-08: an unrelated refactor added a `pub(crate) fn
  // register`, `dock_recent.rs`'s `try_register_with(path, register)` calls
  // `register(path)`, and the whole dock-recent chain was reported as a Windows
  // deadlock it cannot have. Third instance of one class — after bare-name and
  // receiver calls — so the rule, not the instance, is what is fixed here.
  it.each([
    ["a closure parameter", "fn helper(app: &AppHandle, build_it: impl Fn(&AppHandle)) {\n    build_it(app);\n}\n"],
    ["a let binding", "fn helper(app: &AppHandle) {\n    let build_it = |_a: &AppHandle| {};\n    build_it(app);\n}\n"],
  ])("does not charge a cross-file caller for %s that shadows a crate fn", (_label, helper) => {
    const dir = writeTree({
      "src-tauri/src/w.rs": BUILDER(),
      "src-tauri/src/other.rs": `${helper}\n#[tauri::command]\npub fn open_thing(app: AppHandle) {\n    helper(&app, |_a| {});\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  it("still follows a PATH-QUALIFIED call in a body that shadows the name", () => {
    // Shadowing removes only the BARE spelling; `w::build_it(...)` is the item.
    const dir = writeTree({
      "src-tauri/src/w.rs": BUILDER(),
      "src-tauri/src/other.rs":
        `fn helper(app: &AppHandle, build_it: impl Fn(&AppHandle)) {\n    build_it(app);\n    let _ = w::build_it(app);\n}\n` +
        `#[tauri::command]\npub fn open_thing(app: AppHandle) {\n    helper(&app, |_a| {});\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  // audit R3 #99 — the seed was ONE substring, `WebviewWindowBuilder::new`.
  // A site built through another constructor is not a seed, and `seedCount`
  // cannot notice because the existing sites keep it non-zero: the gate reports
  // green while the new command hangs Windows.
  it.each([
    ["a plain WindowBuilder (window without a webview)", "WindowBuilder::new(app, \"x\")"],
    ["a WebviewBuilder added to an existing window", "WebviewBuilder::new(\"x\", WebviewUrl::App(\"/\".into()))"],
    ["from_config instead of new", "WebviewWindowBuilder::from_config(app, &cfg)"],
    ["a turbofish between the type and the constructor", "WebviewWindowBuilder::<R>::new(app, \"x\", WebviewUrl::App(\"/\".into()))"],
  ])("seeds on %s", (_label, call) => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `#[tauri::command]\npub fn open_thing(app: AppHandle) -> Result<(), tauri::Error> {\n` +
        `    let _w = ${call}.build()?;\n    Ok(())\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  it("does not double-count WebviewWindowBuilder as a bare WindowBuilder", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs": `${BUILDER()}\n#[tauri::command(async)]\npub fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("1 builder site(s)");
    expect(code).toBe(0);
  });

  // The gate resolves calls by NAME, so it cannot follow a renamed import. It
  // must say so rather than quietly finding nothing.
  it("refuses an ALIASED builder import instead of failing open", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `use tauri::WebviewWindowBuilder as Wb;\n#[tauri::command]\npub fn open_thing(app: AppHandle) -> Result<(), tauri::Error> {\n` +
        `    let _w = Wb::new(&app, "x", WebviewUrl::App("/".into())).build()?;\n    Ok(())\n}\n`,
    });
    const { code, err } = run(dir);
    expect(err).toContain("imported under an ALIAS");
    expect(err).toContain("`Wb`");
    expect(code).toBe(64);
  });

  it("does not treat an alias named in a COMMENT as an aliased import", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        "// never write: use tauri::WebviewWindowBuilder as Wb; — the gate cannot follow it\n" +
        `${BUILDER()}\n#[tauri::command(async)]\npub fn open_thing(app: AppHandle) {\n    let _ = build_it(&app);\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
  });

  // audit R3 #105 — the attribute lookbehind was a 600-BYTE slice. A longer
  // contiguous attribute block pushed `#[tauri::command]` out of the window,
  // the item stopped being a command, and it left the gate silently.
  it("binds the command attribute across an attribute block longer than any fixed window", () => {
    const filler = Array.from({ length: 40 }, (_, i) => `#[allow(clippy::needless_return_${i}_aaaaaaaaaaaaaaaaaaaa)]`).join("\n");
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `#[tauri::command]\n${filler}\npub fn open_thing(app: AppHandle) -> Result<(), tauri::Error> {\n` +
        `    let _w = WebviewWindowBuilder::new(&app, "x", WebviewUrl::App("/".into())).build()?;\n    Ok(())\n}\n`,
    });
    const { code, err } = run(dir);
    expect(filler.length).toBeGreaterThan(600);
    expect(err).toContain("open_thing");
    expect(code).toBe(1);
  });

  it("still refuses to reach past a non-attribute token for a previous item's attribute", () => {
    const dir = writeTree({
      "src-tauri/src/w.rs":
        `#[tauri::command]\npub async fn commanded(app: AppHandle) -> Result<(), tauri::Error> {\n    let _ = 1;\n    Ok(())\n}\n\n` +
        `pub fn not_a_command(app: &AppHandle) -> Result<(), tauri::Error> {\n` +
        `    let _w = WebviewWindowBuilder::new(app, "x", WebviewUrl::App("/".into())).build()?;\n    Ok(())\n}\n`,
    });
    const { code, out } = run(dir);
    expect(out).toContain("window-creation threading: OK");
    expect(code).toBe(0);
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
