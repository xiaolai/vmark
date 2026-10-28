// WI-AL0.7 — the slice 1.6 gate asserts restore as a controlled mutation, the history panel's uncommitted restore and discard, the document identity lifecycle, the collector's pins-only overflow warning, tombstones, near-cap warning and roots, and legacy retirement, each failing on its own when its fact is missing
/**
 * Runs the REAL `scripts/check-al-slice.sh 1.6` against fixture trees
 * (`--root`), the pattern of `check-al-slice-1-4.test.mjs`: stub `pnpm` and
 * `cargo` first on PATH log their argv and exit 0, so the gate's discovery,
 * tier routing and assertions run for real while the test stays fast.
 *
 * One fixture satisfies every assertion; each case removes exactly one fact
 * and expects the gate red, naming that fact.
 *
 * @coordinates-with scripts/lib/al-slices.sh — al_slice_1_6, the assertions under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, the single-file helper
 * @module scripts/check-al-slice-1-6.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");
const SLICE = path.join(REPO, "scripts", "check-al-slice.sh");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

const STUB = `#!/usr/bin/env bash
echo "$(basename "$0") $*" >> "$STUB_LOG"
if [[ "$(basename "$0")" == cargo ]]; then echo "test result: ok. 3 passed; 0 failed"; fi
exit 0
`;

/** Each Rust test module, the facts its file names. */
const RUST = {
  restore: ["restore", "baseline", "revert", "barrier", "supersedes"],
  identity: ["external_rename", "save_as", "reopen", "copy", "symlink", "canonical",
    "a_case_insensitive_volume_resolves_another_spelling_to_the_same_document",
    "composed_and_decomposed_missing_names_keep_their_own_keys",
    "windows_separators_and_verbatim_prefixes_clean_up_to_one_text",
    "a_windows_verbatim_unc_prefix_becomes_a_unc_path_never_a_relative_one",
    "path_text_keeps_case_and_unicode_form_exactly",
    "a_case_alias_of_several_hard_links_is_refused_without_writing",
    "a_provisional_alias_is_found_when_the_stored_spelling_comes_first",
    "an_existing_file_is_keyed_by_its_stored_spelling",
    "missing_names_keep_their_exact_spelling",
    "hard_links_keep_their_own_documents_and_a_case_alias_is_refused",
  ],
  gc: ["pins_only", "warn", "tombstone", "collect", "near_cap", "barrier", "last_certified", "capture_base",
    "observed_parent", "observed_preimage", "pin"],
  legacy: ["retire", "idempotent", "not_verified"],
};
const PANEL = ["uncommitted", "restore", "discard", "resolves", "pin"];
const PANEL_TEST = "src/components/McpHistory/UncommittedEntries.test.tsx";

/** Linked tests naming `words` in CODE (a literal, a case title): the gate blanks comments. */
const rustTest = (name, words) => `// WI-AL1.6 — ${name}\n#[test]\nfn case() { let _ = ${JSON.stringify(words.join(" "))}; }\n`;
const tsTest = (words) => `// WI-AL1.6 — history panel\nimport { it } from "vitest";\nit(${JSON.stringify(words.join(" "))}, () => {});\n`;

/** A tree satisfying every slice 1.6 assertion. */
function satisfied({ rust = RUST, panel = PANEL } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "al-slice16-"));
  made.push(root);
  for (const tool of ["pnpm", "cargo"]) {
    write(root, `bin/${tool}`, STUB);
    chmodSync(path.join(root, "bin", tool), 0o755);
  }
  write(root, "src-tauri/src/lib.rs", "mod agent_journal;\n");
  write(root, "src-tauri/src/agent_journal/mod.rs", Object.keys(rust).map((m) => `mod ${m};\n`).join(""));
  for (const [name, words] of Object.entries(rust)) {
    write(root, `src-tauri/src/agent_journal/${name}.rs`, `#[cfg(test)]\n#[path = "${name}.test.rs"]\nmod tests;\n`);
    write(root, `src-tauri/src/agent_journal/${name}.test.rs`, rustTest(name, words));
  }
  write(root, "src-tauri/src/agent_journal/writer_gc.rs", "pub fn collect() {}\n");
  write(root, "src-tauri/src/agent_journal/service.rs", "fn start() { retire_legacy_file(); }\n");
  write(root, PANEL_TEST, tsTest(panel));
  return root;
}

function slice(root) {
  const log = path.join(root, "exec.log");
  const r = spawnSync("bash", [SLICE, "1.6", `--root=${root}`], {
    encoding: "utf8",
    cwd: REPO,
    env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH}`, STUB_LOG: log },
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return { status: r.status, out: `${r.stdout}${r.stderr}`, log: existsSync(log) ? readFileSync(log, "utf8") : "" };
}

const without = (list, word) => list.filter((w) => w !== word);
const rustWithout = (mod, word) => ({ ...RUST, [mod]: without(RUST[mod], word) });

describe("check-al-slice.sh 1.6", () => {
  it("passes on a satisfied tree, running the app and Rust tiers", () => {
    const r = slice(satisfied());
    expect(r.status, r.out).toBe(0);
    expect(r.log).toContain(`pnpm vitest run ${PANEL_TEST}`);
    expect(r.log).toContain("agent_journal::gc::");
  });

  it.each([
    ["restore", "baseline", "overwritten buffer first"],
    ["restore", "revert", "is revertible"],
    ["restore", "supersedes", "never supersedes"],
    ["identity", "external_rename", "identity lifecycle"],
    ["identity", "save_as", "identity lifecycle"],
    ["identity", "reopen", "identity lifecycle"],
    ["identity", "copy", "identity lifecycle"],
    ["identity", "symlink", "symlink and its target"],
    ["identity", "a_case_insensitive_volume_resolves_another_spelling_to_the_same_document", "another spelling of an existing file"],
    ["identity", "composed_and_decomposed_missing_names_keep_their_own_keys", "a missing name keeps its exact spelling"],
    ["identity", "windows_separators_and_verbatim_prefixes_clean_up_to_one_text", "Windows separators"],
    ["identity", "a_windows_verbatim_unc_prefix_becomes_a_unc_path_never_a_relative_one", "Windows separators"],
    ["identity", "path_text_keeps_case_and_unicode_form_exactly", "no case or Unicode folding"],
    ["identity", "a_case_alias_of_several_hard_links_is_refused_without_writing", "ambiguous hard-link alias"],
    ["identity", "a_provisional_alias_is_found_when_the_stored_spelling_comes_first", "a provisional alias resolves"],
    ["identity", "an_existing_file_is_keyed_by_its_stored_spelling", "stored spelling and exact missing names"],
    ["identity", "missing_names_keep_their_exact_spelling", "stored spelling and exact missing names"],
    ["identity", "hard_links_keep_their_own_documents_and_a_case_alias_is_refused", "hard links stay separate documents"],
    ["gc", "pins_only", "exceeded only by pinned records"],
    ["gc", "tombstone", "tombstones for collected runs"],
    ["gc", "near_cap", "80% of the cap"],
    ["gc", "last_certified", "lastCertified revisions"],
    ["gc", "capture_base", "capture bases"],
    ["gc", "observed_parent", "observed roots"],
    ["gc", "observed_preimage", "observed roots"],
    ["legacy", "idempotent", "retirement is idempotent"],
    ["legacy", "not_verified", "unverified original"],
  ])("fails when the %s test no longer names %s (%s)", (mod, word, label) => {
    const r = slice(satisfied({ rust: rustWithout(mod, word) }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label}`));
  });

  it.each(["uncommitted", "discard", "resolves", "pin"])(
    "the history panel test must name %s",
    (word) => {
      const r = slice(satisfied({ panel: without(PANEL, word) }));
      expect(r.status).toBe(1);
      expect(r.out).toMatch(/✗ [^\n]*history panel's uncommitted restore and discard/);
    },
  );

  it("the restore and discard test must be a component test: a linked service test naming every fact fails", () => {
    const root = satisfied();
    const moved = "src/services/agentJournal/__tests__/uncommitted.test.tsx";
    mkdirSync(path.dirname(path.join(root, moved)), { recursive: true });
    renameSync(path.join(root, PANEL_TEST), path.join(root, moved));
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*history panel's uncommitted restore and discard/);
  });

  it("facts split across Rust files do not satisfy one assertion", () => {
    const rust = { ...RUST, gc: without(RUST.gc, "warn"), legacy: [...RUST.legacy, "warn"] };
    const r = slice(satisfied({ rust }));
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*exceeded only by pinned records/);
  });

  it("fails when the journal has no collector", () => {
    const root = satisfied();
    write(root, "src-tauri/src/agent_journal/writer_gc.rs", "pub fn other() {}\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*has a collector/);
  });

  it("fails when startup no longer retires the legacy file", () => {
    const root = satisfied();
    write(root, "src-tauri/src/agent_journal/service.rs", "fn start() {}\n");
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/✗ [^\n]*retires the verified legacy checkpoint file/);
  });

  it.each([
    ["src-tauri/src/agent_journal/service.rs", "fn start() {\n    // retire_legacy_file();\n}\n", /retires the verified legacy checkpoint file/],
    ["src-tauri/src/agent_journal/writer_gc.rs", "/// pub fn collect() is planned\npub fn other() {}\n", /has a collector/],
  ])("fails when %s names its fact only in a comment", (file, body, label) => {
    const root = satisfied();
    write(root, file, body);
    const r = slice(root);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(new RegExp(`✗ [^\\n]*${label.source}`));
  });
});
