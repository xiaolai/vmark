// WI-AL0.7 — the phase 1 Definition of Done names one test per fact (two clients, two windows across compaction, crash at every journal step, a failed commit not durable, Save As/rename/reopen and copy identity, the CJK byte cap, legacy entries and restart, disk full and permission denied, a burst of 100 writes), each failing on its own when its fact is missing
/**
 * Runs the REAL `scripts/check-al-phase.sh 1 --no-exec` against fixture
 * trees (`--root`). Under `--no-exec` the phase is red by design (nothing is
 * run), so each case reads the one assertion line it is about: a fixture
 * naming every fact passes every DoD line, and removing one scenario word
 * from one test turns exactly that line red.
 *
 * @coordinates-with scripts/check-al-phase.sh — phase_1, the assertions under test
 * @coordinates-with scripts/lib/al-gate.sh — al_test_has, the single-file helper
 * @module scripts/check-al-phase-1.test
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

const J = "src-tauri/src/agent_journal";
/** Each DoD fact: the test file, its work item, the words it names, and the gate's label. */
const FACTS = {
  clients: { file: "src/services/coherence/mcpCapture.connections.test.ts", wi: "WI-AL1.5",
    words: ["two-client read isolation", "concurrent writes by two clients", "recorded under the actor"],
    label: "two concurrent clients keep separate reads and attribution" },
  windows: { file: `${J}/window_convergence.test.rs`, wi: "WI-AL1.2",
    words: ["HydratedView", "collect(", "drop_next_broadcasts", "reopen"],
    label: "two windows converge and lose no entries after compaction" },
  crash: { file: `${J}/durability.test.rs`, wi: "WI-AL1.2",
    words: ["tear_next_append_after", "TempWritten", "TempSynced", "Renamed", "DirSynced"],
    label: "a crash at append, temp write, fsync, rename or dir-sync recovers" },
  durable: { file: `${J}/controller.test.rs`, wi: "WI-AL1.3",
    words: ["out.applied && !out.durable"],
    label: "a failed commit answers applied but not durable" },
  identity: { file: `${J}/identity.test.rs`, wi: "WI-AL1.6",
    words: ["untitled_save_as_then_rename_then_reopen", "a_copy_is_a_new_document"],
    label: "untitled, Save As, rename and reopen keep one document; a copy gets a new one" },
  cjk: { file: `${J}/schema.test.rs`, wi: "WI-AL1.2",
    words: ["bytes_not_chars", "中"],
    label: "the session label byte cap counts CJK bytes" },
  restart: { file: `${J}/protocol.test.rs`, wi: "WI-AL1.2",
    words: ["legacy_checkpoints_migrate_once_and_stay_outside_revision_chains", "restart_projection_equals_live_projection"],
    label: "legacy entries stay legacy and a restart keeps everything" },
  storage: { file: `${J}/failure_modes.test.rs`, wi: "WI-AL1.2",
    words: ["StorageFull", "PermissionDenied", "JOURNAL_IO", "Phase::Failed"],
    label: "disk full and permission denied fail loud" },
  burst: { file: `${J}/generation_events.test.rs`, wi: "WI-AL1.7",
    words: ["100_rapid_writes"],
    label: "a burst of 100 writes all land" },
};

function write(root, rel, body) {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

/**
 * A linked test naming `words` in CODE — string literals, since the gate
 * reads a test's code with comments blanked: a `#[test]` fn for Rust, `it()`
 * titles for TypeScript.
 */
function testBody(file, wi, words) {
  const lit = (w) => JSON.stringify(w);
  if (file.endsWith(".rs")) {
    return `// ${wi} — fixture\n#[test]\nfn names() {\n${words.map((w) => `    let _ = ${lit(w)};`).join("\n")}\n}\n`;
  }
  return `// ${wi} — fixture\nimport { it } from "vitest";\n${words.map((w) => `it(${lit(w)}, () => {});`).join("\n")}\n`;
}

/** A tree whose tests name every fact, minus `drop` = [fact, word]. */
function fixture(drop = null) {
  const root = mkdtempSync(path.join(tmpdir(), "al-phase1-"));
  made.push(root);
  for (const [key, f] of Object.entries(FACTS)) {
    const words = drop && drop[0] === key ? f.words.filter((w) => w !== drop[1]) : f.words;
    write(root, f.file, testBody(f.file, f.wi, words));
  }
  return root;
}

function phase1(root) {
  const r = spawnSync("bash", [PHASE, "1", `--root=${root}`, "--no-exec"], {
    encoding: "utf8",
    cwd: REPO,
    timeout: 120_000,
    killSignal: "SIGKILL",
  });
  if (r.error) throw r.error;
  return `${r.stdout}${r.stderr}`;
}

const line = (out, label) => out.split("\n").find((l) => l.includes(`phase 1: ${label}`)) ?? "";

describe("check-al-phase.sh 1 — one test per Definition of Done fact", () => {
  it("passes every fact on a tree whose tests name them all", () => {
    const out = phase1(fixture());
    for (const f of Object.values(FACTS)) expect(line(out, f.label), out).toMatch(/^\s*✓/);
  });

  it.each(Object.entries(FACTS).flatMap(([key, f]) => f.words.map((w) => [key, w])))(
    "fails the %s fact when its test no longer names %s, and only that fact",
    (key, word) => {
      const out = phase1(fixture([key, word]));
      for (const [other, f] of Object.entries(FACTS)) {
        expect(line(out, f.label), out).toMatch(other === key ? /^\s*✗/ : /^\s*✓/);
      }
    },
  );
});
