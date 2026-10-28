// WI-AL0.7 — the phase 4 Definition of Done names one test per fact (the collected-run fixture with its synthetic tree, idempotent re-export also after journal GC, compare-and-swap conflict, unrelated branch refused, round-trip, Windows paths, missing Git, Git through build_command, an entry point the composition root registers), each failing on its own when its fact is missing
/**
 * Runs the REAL `scripts/check-al-phase.sh 4 --no-exec` against fixture
 * trees (`--root`). Under `--no-exec` the phase is red by design (nothing is
 * run), so each case reads the one assertion line it is about: a fixture
 * naming every fact passes every DoD line, and removing one scenario word
 * from one file turns exactly that line red. The Windows-only witness is
 * judged for windows (`al_test_for_target`): it counts only while the crate
 * mounts names.test.rs for windows, and its ok line says this gate did not
 * execute it. The host requirement names the platform test the host compiles.
 *
 * @coordinates-with scripts/check-al-phase.sh — phase_4, the assertions under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, al_test_for_target and al_code_has
 * @module scripts/check-al-phase-4.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const PHASE = path.join(REPO, "scripts", "check-al-phase.sh");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const G = "src-tauri/src/agent_journal/git_export";
/** The platform test the host's own build compiles, required by the host line. */
const OWN_PLATFORM = process.platform === "win32" ? "drive_and_unc_spellings_are_absolute_on_windows" : "foreign_platform_spellings_are_relative_on_unix";
/**
 * Each DoD fact: the file, whether it is a linked test, the words it names,
 * and the gate's label. The gate reads CODE, so a test names its words in a
 * string literal and a source fact through `code`, never in a comment.
 */
const FACTS = {
  fixture: { file: `${G}/export.test.rs`, test: true,
    words: ["collected_run_fixture_exports_one_synthetic_commit_and_re_export_is_idempotent", "VMark-Collected", "VMark-Actors"],
    label: "the collected-run fixture exports one synthetic commit with sorted VMark-Actors, and re-export is idempotent" },
  tree: { file: `${G}/plan.test.rs`, test: true,
    words: ["collected_run_fixture_plans_exactly_one_synthetic_commit", "the_synthetic_tree_is_the_linear_before_text"],
    label: "the synthetic commit's tree is the next retained revision's before-text" },
  gc: { file: `${G}/gc.test.rs`, test: true,
    words: ["re_export_after_journal_gc_appends_only_new_revisions"],
    label: "re-export after journal GC appends only new revisions" },
  conflict: { file: `${G}/cas.test.rs`, test: true,
    words: ["a_branch_advanced_elsewhere_is_a_conflict_not_an_overwrite", "a_ref_moved_during_export_is_a_conflict_by_compare_and_swap"],
    label: "a branch advanced elsewhere is a conflict, by compare-and-swap" },
  unrelated: { file: `${G}/refuse.test.rs`, test: true,
    words: ["export_into_a_non_empty_unrelated_branch_is_refused"],
    label: "export into a non-empty unrelated branch is refused" },
  roundTrip: { file: `${G}/round.test.rs`, test: true,
    words: ["round_trip_on_a_fixture_journal_reads_every_revision_back"],
    label: "round-trip on a fixture journal" },
  windows: { file: `${G}/names.test.rs`, test: true,
    words: ["tree_file_name_splits_windows_backslash_paths_on_every_platform", "repository_paths_must_be_absolute_on_this_platform",
      OWN_PLATFORM],
    label: "Windows path handling (" },
  // Shares names.test.rs as a second fn compiled only for Windows, as in the real file.
  windowsOnly: { file: `${G}/names.test.rs`, test: true, cfg: "#[cfg(windows)]", fn: "names_on_windows",
    words: ["drive_and_unc_spellings_are_absolute_on_windows"],
    label: "Windows path handling — windows witness" },
  missingGit: { file: `${G}/git.test.rs`, test: true,
    words: ["missing_git_is_a_clear_message"],
    label: "missing Git gives a clear message" },
  buildCommand: { file: `${G}/git.rs`, test: false,
    words: ["ai_provider::{build_command"], code: (w) => `use crate::${w}};`,
    label: "Git runs through ai_provider::build_command" },
  branch: { file: `${G}/names.rs`, test: false,
    words: ["vmark-journal/"], code: (w) => `pub const BRANCH: &str = "${w}";`,
    label: "exports to a vmark-journal/<document-uuid> branch" },
  entry: { file: "src/services/commands/exportReach.test.ts", test: true, ts: true,
    words: ["registerAllCommands", "history.exportToGit", "agent_journal_git_export"],
    label: "the export is reachable from the app: registerAllCommands registers history.exportToGit, and running it invokes agent_journal_git_export" },
};

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

/** One fact's file naming `words` in code. */
function body(f, words) {
  if (!f.test) return `// source fixture\n${words.map(f.code).join("\n")}\n`;
  if (f.ts) {
    return `// WI-AL4.1 — fixture\nimport { it } from "vitest";\nit("names", () => {\n${words.map((w) => `  void ${JSON.stringify(w)};`).join("\n")}\n});\n`;
  }
  return `${f.cfg ?? ""}\n#[test]\nfn ${f.fn ?? "names"}() {\n${words.map((w) => `    let _ = ${JSON.stringify(w)};`).join("\n")}\n}\n`;
}

/** The crate's mount chain down to every Rust test fact, names.test.rs's mount under `cfg`. */
const mounts = (cfg = "#[cfg(test)]") => {
  const tests = [...new Set(Object.values(FACTS).filter((f) => f.test && !f.ts).map((f) => path.posix.basename(f.file)))];
  const mount = (t) => `${t === "names.test.rs" ? cfg : "#[cfg(test)]"}\n#[path = "${t}"]\nmod ${t.replace(/\.test\.rs$/, "")}_tests;\n`;
  return {
    "src-tauri/src/lib.rs": "pub mod agent_journal;\n",
    "src-tauri/src/agent_journal/mod.rs": "pub mod git_export;\n",
    [`${G}/mod.rs`]: tests.map(mount).join(""),
  };
};

/** A tree naming every fact, minus `drop` = [fact, word], its names.test.rs mounted under `mountCfg`. */
function fixture(drop = null, mountCfg = undefined) {
  const root = mkdtempSync(path.join(tmpdir(), "al-phase4-"));
  made.push(root);
  const files = new Map();
  for (const [key, f] of Object.entries(FACTS)) {
    const words = drop && drop[0] === key ? f.words.filter((w) => w !== drop[1]) : f.words;
    const rustTest = f.test && !f.ts;
    files.set(f.file, (files.get(f.file) ?? (rustTest ? "// WI-AL4.1 — fixture\n" : "")) + body(f, words));
  }
  for (const [file, text] of files) write(root, file, text);
  for (const [file, text] of Object.entries(mounts(mountCfg))) write(root, file, text);
  return root;
}

function phase4(root) {
  const r = spawnSync("bash", [PHASE, "4", `--root=${root}`, "--no-exec"], {
    encoding: "utf8",
    cwd: REPO,
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return `${r.stdout}${r.stderr}`;
}

const line = (out, label) => out.split("\n").find((l) => l.includes(`phase 4: ${label}`)) ?? "";

describe("check-al-phase.sh 4 — one check per Definition of Done fact", () => {
  it("passes every fact on a tree that names them all", () => {
    const out = phase4(fixture());
    for (const f of Object.values(FACTS)) expect(line(out, f.label), out).toMatch(/^\s*✓/);
  });

  it.each(Object.entries(FACTS).flatMap(([key, f]) => f.words.map((w) => [key, w])))(
    "fails the %s fact when its file no longer names %s, and only that fact",
    (key, word) => {
      const out = phase4(fixture([key, word]));
      for (const [other, f] of Object.entries(FACTS)) {
        expect(line(out, f.label), out).toMatch(other === key ? /^\s*✗/ : /^\s*✓/);
      }
    },
  );

  it.each([
    ["compiled out on windows", "#[cfg(all(test, not(windows)))]", /compiled out on the named target \(windows\)/],
    ["gated on a feature", '#[cfg(all(test, feature = "win"))]', /not a predicate this probe evaluates/],
  ])("fails only the Windows witness when its file's mount is %s", (_n, cfg, why) => {
    const out = phase4(fixture(null, cfg));
    for (const [key, f] of Object.entries(FACTS)) expect(line(out, f.label), out).toMatch(key === "windowsOnly" ? /^\s*✗/ : /^\s*✓/);
    expect(line(out, FACTS.windowsOnly.label)).toMatch(why);
  });

  it("says plainly that this gate compiled-checked, not executed, the Windows witness", () => {
    const l = line(phase4(fixture()), FACTS.windowsOnly.label);
    expect(l).toContain("compiled for windows; NOT executed by this gate (Windows CI only)");
    expect(l).not.toMatch(/executed by CI/);
  });

  it("the host requirement does not accept the Windows-only witness", () => {
    const root = fixture();
    const f = FACTS.windows;
    write(root, f.file, `// WI-AL4.1 — fixture\n${body({ ...f, cfg: "#[cfg(windows)]", fn: "host_names_on_windows" }, f.words)}${body(FACTS.windowsOnly, FACTS.windowsOnly.words)}`);
    expect(line(phase4(root), f.label)).toMatch(/^\s*✗/);
  });

  it("a fact named only in an unlinked test does not count", () => {
    const root = fixture();
    write(root, FACTS.missingGit.file, `// no work item\n// ${FACTS.missingGit.words[0]}\n`);
    expect(line(phase4(root), FACTS.missingGit.label)).toMatch(/^\s*✗/);
  });

  it("an export client that spells the command, with no composition-root test, does not prove reachability", () => {
    const root = fixture();
    rmSync(path.join(root, FACTS.entry.file));
    write(root, "src/services/agentJournal/gitExportClient.ts", 'invoke("agent_journal_git_export");\n');
    expect(line(phase4(root), FACTS.entry.label)).toMatch(/^\s*✗/);
  });

  it.each(["buildCommand", "branch", "entry", "missingGit"])("the %s fact named only in a comment does not count", (key) => {
    const root = fixture();
    const f = FACTS[key];
    write(root, f.file, `${f.test ? "// WI-AL4.1 — fixture\n" : ""}// ${f.words.join(" ")}\n`);
    expect(line(phase4(root), f.label)).toMatch(/^\s*✗/);
  });
});
