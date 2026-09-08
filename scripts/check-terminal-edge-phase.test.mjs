/**
 * Self-test for scripts/check-terminal-edge-phase.sh — the helpers, both ways.
 *
 * The negative assertions (`assert_no_grep` / `assert_no_re`) are the
 * contract "this text is GONE". grep exits 2 on a missing file, and that
 * status used to land in the "absent" branch: delete the file the assertion
 * guards and the phase passed. A fixture tree proves the missing-target case
 * is red, the present-and-clean case is green, and the still-present case is
 * red. The live tree is deliberately not pinned here — the checker is a plan
 * DoD script, and its assertions against `src/` evolve with the code.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(REPO, "scripts", "check-terminal-edge-phase.sh");
const SPAWN = "src/components/Terminal/spawnPty.ts";

function run(root, ...args) {
  return spawnSync("bash", [SCRIPT, ...args, `--root=${root}`], { encoding: "utf8", cwd: REPO });
}
function fixture(files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "te-dod-"));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  }
  return root;
}

describe("check-terminal-edge-phase.sh", () => {
  it("exits 64 with usage when no phase is given, and on an unknown phase", () => {
    const none = run(fixture());
    expect(none.status).toBe(64);
    expect(none.stdout).toContain("Usage");
    expect(run(fixture(), "9").status).toBe(64);
  });

  it("exits 64 with usage on a second positional argument instead of silently checking the last one", () => {
    // Audit 20260907 #51: `2 3` used to check phase 3 and report it as the run asked for.
    const extra = run(fixture(), "2", "3");
    expect(extra.status).toBe(64);
    expect(extra.stdout).toContain("Usage");
    expect(extra.stdout).toContain("unexpected extra argument: 3");
  });

  it("the T10 translation check parses the bundles by key — English survives any JSON spacing, a translation passes, a missing bundle fails", () => {
    // Audit 20260907 #54/#55: the check grepped five literal English values
    // as `": "value"`, so a bundle written without the space after the colon
    // passed with the English still in it, and the three `.description`
    // strings were never looked at. Now every T10 key is compared against
    // en/ after parsing.
    const en = {
      "terminal.shellIntegration.label": "Shell Integration",
      "terminal.shellIntegration.description": "Inject command markers",
      "terminal.scrollback.label": "Scrollback",
      "terminal.scrollback.description": "Lines of history",
      "terminal.screenReaderMode.label": "Screen Reader Mode",
      "terminal.screenReaderMode.description": "Expose output",
      "terminal.contrast.aa": "WCAG AA (4.5:1)",
      "terminal.contrast.aaa": "WCAG AAA (7:1)",
    };
    const translated = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, `«${v}»`]));
    // de: one description left in English, and the file written COMPACT (no
    // space after the colon) — the spelling the old grep could not see.
    const de = { ...translated, "terminal.scrollback.description": en["terminal.scrollback.description"] };
    const r = run(
      fixture({
        "src/locales/en/settings.json": JSON.stringify(en, null, 2),
        "src/locales/de/settings.json": JSON.stringify(de),
        "src/locales/es/settings.json": JSON.stringify(translated, null, 2),
      }),
      "2",
    );
    expect(r.stdout).toContain("✗ WI-2.3 de terminal settings strings translated (still English, empty or missing: terminal.scrollback.description");
    expect(r.stdout).toContain("✓ WI-2.3 es terminal settings strings translated");
    expect(r.stdout).toContain("✗ WI-2.3 fr terminal settings strings translated (could not compare:");
  });

  // audit R2 #81 — two ways the check used to pass vacuously: an EMPTY
  // localized string is a string and differs from the English one, and a key
  // the ENGLISH bundle no longer carries compared `"…" !== undefined`, so a
  // renamed key read as translated in every locale.
  it("refuses an empty translation and a key with no English reference", () => {
    const en = {
      "terminal.shellIntegration.label": "Shell Integration",
      "terminal.shellIntegration.description": "Inject command markers",
      "terminal.scrollback.label": "Scrollback",
      "terminal.scrollback.description": "Lines of history",
      "terminal.screenReaderMode.label": "Screen Reader Mode",
      "terminal.screenReaderMode.description": "Expose output",
      "terminal.contrast.aa": "WCAG AA (4.5:1)",
      "terminal.contrast.aaa": "WCAG AAA (7:1)",
    };
    const translated = Object.fromEntries(Object.entries(en).map(([k, v]) => [k, `«${v}»`]));
    const blank = { ...translated, "terminal.scrollback.label": "   " };
    expect(
      run(
        fixture({
          "src/locales/en/settings.json": JSON.stringify(en, null, 2),
          "src/locales/de/settings.json": JSON.stringify(blank),
          "src/locales/es/settings.json": JSON.stringify(translated, null, 2),
        }),
        "2",
      ).stdout,
    ).toContain("✗ WI-2.3 de terminal settings strings translated (still English, empty or missing: terminal.scrollback.label");
    // The English key is GONE (renamed); every locale still carries a value.
    const { "terminal.contrast.aaa": _dropped, ...enRenamed } = en;
    expect(
      run(
        fixture({
          "src/locales/en/settings.json": JSON.stringify(enRenamed, null, 2),
          "src/locales/de/settings.json": JSON.stringify(translated, null, 2),
          "src/locales/es/settings.json": JSON.stringify(translated, null, 2),
        }),
        "2",
      ).stdout,
    ).toContain("✗ WI-2.3 de terminal settings strings translated (no English reference string: terminal.contrast.aaa");
  });

  // audit R2 #79 — assertions whose subject is a TEST go through
  // scripts/dod-syntax.mjs, so a skipped case cannot stand in for a running one.
  it("names its test assertions by title through the syntax probe, not grep", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain("assert_test_title()");
    expect(src).toContain("assert_rust_test_fn()");
    expect(src).toContain('assert_test_title "read is denied"');
    // No test-title assertion may be left as a plain grep.
    expect(src).not.toMatch(/assert_grep "[^"]*" "[^"]*\.test\.tsx?"/);
  });

  it("a skipped case does not satisfy a title assertion", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "terminal-edge-title-"));
    const file = path.join(dir, "t.test.ts");
    writeFileSync(file, 'it.skip("read is denied", () => {});\n');
    const probe = path.join(REPO, "scripts", "dod-syntax.mjs");
    expect(spawnSync(process.execPath, [probe, "ts-has-test-case", file, "read is denied"]).status).toBe(1);
    writeFileSync(file, 'it("read is denied", () => {});\n');
    expect(spawnSync(process.execPath, [probe, "ts-has-test-case", file, "read is denied"]).status).toBe(0);
  });

  it("a negative assertion is RED when its target file is missing — absence of the file is not absence of the text", () => {
    const r = run(fixture(), "1");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(`✗ WI-1.1 spawnPty no longer sets EDITOR (target missing: ${SPAWN})`);
    expect(r.stdout).toContain("✗ WI-1.1 docs no longer advertise EDITOR=vmark (target missing: website/guide/terminal.md)");
  });

  it("a negative assertion is green only when the target exists and lacks the text, red when the text is still there", () => {
    const clean = run(fixture({ [SPAWN]: 'const env = { TERM_PROGRAM: "WezTerm" };\n' }), "1");
    expect(clean.stdout).toContain("✓ WI-1.1 spawnPty no longer sets EDITOR");
    // `\s` used to spell the indent; a portable class must still see an indented line.
    const dirty = run(fixture({ [SPAWN]: 'const env = {\n    EDITOR: "vmark",\n};\n' }), "1");
    expect(dirty.stdout).toContain("✗ WI-1.1 spawnPty no longer sets EDITOR (regex '^[[:space:]]*EDITOR:' still matches");
  });

  // audit R2 #80 — four wrappers each branched on grep's status separately, so
  // the two POSITIVE ones answered "could not look" with the pattern's name:
  // `pattern 'X' not in <file>` for a file that does not exist is a true
  // verdict with a false reason, and it sends a reader to the wrong place.
  // One matcher now answers all four, so the missing-target message is the
  // same one the negative assertions have always given.
  it("a positive assertion names a missing target instead of blaming the pattern", () => {
    const r = run(fixture({ [SPAWN]: "const env = {};\n" }), "1");
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      "✗ WI-1.1 ADR-006 WezTerm impersonation preserved (target missing: src/components/Terminal/terminalSpawnEnv.ts)",
    );
    expect(r.stdout).not.toContain("not in src/components/Terminal/terminalSpawnEnv.ts");
  });
});
