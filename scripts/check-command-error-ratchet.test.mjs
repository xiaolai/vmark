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
import {
  findStringifiedTypedErrors,
  typedCommandNames,
} from "./check-command-error-ratchet.mjs";
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

// ─── WI-DP2.7: typed commands must not be stringified in the frontend ───
//
// A `CommandError` serialises as a plain OBJECT, so `String(error)` on one
// renders the literal "[object Object]". This shipped to users at four
// boundaries before it was caught by hand (WI-DP2.6). With ~49 conversions
// still to go, every one of them can reintroduce it — so the ratchet that
// drives those conversions is also the thing that has to assert against it.

describe("typedCommandNames", () => {
  it("names commands returning CommandError, and not the legacy ones", () => {
    const source = `
      #[tauri::command]
      pub fn typed_one(app: AppHandle) -> Result<(), CommandError> { Ok(()) }

      #[tauri::command]
      pub async fn legacy_one() -> Result<String, String> { Ok(String::new()) }

      #[tauri::command(rename_all = "snake_case")]
      pub fn typed_two() -> Result<Vec<u8>, crate::command_error::CommandError> { Ok(vec![]) }
    `;
    expect(typedCommandNames(source).sort()).toEqual(["typed_one", "typed_two"]);
  });

  it("ignores a command name that appears only inside a comment", () => {
    const source = `
      // #[tauri::command] pub fn ghost() -> Result<(), CommandError> {}
      #[tauri::command]
      pub fn real() -> Result<(), CommandError> { Ok(()) }
    `;
    expect(typedCommandNames(source)).toEqual(["real"]);
  });
});

describe("findStringifiedTypedErrors", () => {
  const typed = new Set(["hot_exit_capture"]);

  it("flags a file that invokes a typed command and stringifies its error", () => {
    const file = {
      path: "src/pages/settings/X.tsx",
      source: `const r = await invoke("hot_exit_capture");
               } catch (error) { setError(String(error)); }`,
    };
    const hits = findStringifiedTypedErrors([file], typed);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ file: "src/pages/settings/X.tsx", command: "hot_exit_capture" });
  });

  // `errorMessage()` is literally `error instanceof Error ? … : String(error)`,
  // so it carries the identical defect under a different name — and rule 50 §10
  // names it explicitly. Catching only the `String(...)` spelling would leave
  // the same bug reachable by import.
  it("flags the errorMessage() helper too, not just String()", () => {
    const file = {
      path: "src/x.ts",
      source: `import { errorMessage } from "@/utils/errorMessage";
               await invoke("hot_exit_capture");
               } catch (error) { warn(errorMessage(error)); }`,
    };
    const hits = findStringifiedTypedErrors([file], typed);
    expect(hits).toHaveLength(1);
  });

  // The check is FILE-level: it cannot tell which error a helper was applied to.
  // `shortcuts.ts` invokes a typed command AND stringifies a JSON.parse failure,
  // which is correct. House pattern for that (i18n allowlist, focus caret-only):
  // a marker carrying a REASON, because an unexplained suppression is a mute
  // button.
  it("honours `command-error-ok:` with a reason", () => {
    const file = {
      path: "src/parse.ts",
      source: `await invoke("hot_exit_capture");
               // command-error-ok: this is a JSON.parse failure, not the invoke's rejection
               } catch (e) { report(errorMessage(e)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });

  it("REJECTS a bare marker with no reason", () => {
    const file = {
      path: "src/bare.ts",
      source: `await invoke("hot_exit_capture");
               // command-error-ok:
               } catch (e) { report(errorMessage(e)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toHaveLength(1);
  });

  it("does NOT flag commandErrorMessage, whose name contains errorMessage", () => {
    const file = {
      path: "src/y.ts",
      source: `await invoke("hot_exit_capture");
               } catch (error) { warn(commandErrorMessage(error)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });

  it("does NOT flag a file that already routes through commandErrorMessage", () => {
    const file = {
      path: "src/ok.ts",
      source: `import { commandErrorMessage } from "@/services/commands/commandError";
               await invoke("hot_exit_capture");
               } catch (error) { setError(commandErrorMessage(error)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });

  it("does NOT flag stringification in a file that only invokes LEGACY commands", () => {
    // `String(error)` is CORRECT while the command still returns Result<T, String>.
    // Flagging it would make the gate demand a change that is wrong today.
    const file = {
      path: "src/legacy.ts",
      source: `await invoke("print_document");
               } catch (error) { fail(String(error)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });

  it("does NOT flag String() applied to something that is not a caught error", () => {
    const file = {
      path: "src/other.ts",
      source: `await invoke("hot_exit_capture");
               const label = String(count);`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });

  it("treats a typed command named only in a comment as not invoked", () => {
    const file = {
      path: "src/commented.ts",
      source: `// once we call invoke("hot_exit_capture") this will matter
               } catch (error) { setError(String(error)); }`,
    };
    expect(findStringifiedTypedErrors([file], typed)).toEqual([]);
  });
});

// The wiring, not the pure function. Every unit test above still passes if the
// `scanStringifiedTypedErrors(root)` call is deleted from main() — which is
// precisely the "green while doing nothing" failure this pins shut.
describe("check-command-error-ratchet.mjs — the String() check is actually wired in", () => {
  function writeFrontend(root, files) {
    for (const [rel, content] of Object.entries(files)) {
      const full = path.join(root, "src", rel);
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }

  it("fails the whole gate when a frontend file stringifies a typed command's error", () => {
    const root = writeCrate({ "a.rs": command("typed_cmd", "Result<(), CommandError>") });
    writeFrontend(root, {
      "bad.ts": 'const r = await invoke("typed_cmd");\n} catch (error) { show(String(error)); }',
    });
    const { status, stderr } = runGate(root, { files: {} });
    expect(status).toBe(1);
    expect(stderr).toContain("bad.ts");
    expect(stderr).toContain("typed_cmd");
  });

  it("stays green when the same file uses commandErrorMessage", () => {
    const root = writeCrate({ "a.rs": command("typed_cmd", "Result<(), CommandError>") });
    writeFrontend(root, {
      "ok.ts":
        'import { commandErrorMessage } from "@/services/commands/commandError";\n' +
        'const r = await invoke("typed_cmd");\n} catch (error) { show(commandErrorMessage(error)); }',
    });
    expect(runGate(root, { files: {} }).status).toBe(0);
  });
});
