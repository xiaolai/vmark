/**
 * Self-test for the shared DoD assertion library.
 *
 * The library had none of its own: every helper was exercised only through a
 * phase checker, so the cases that matter most here — what happens when grep
 * cannot LOOK, when the caller forgot to set EXEC, when a probe spec is
 * malformed — were unreachable from any test, since a real tree does not
 * produce them on demand. Each is constructed directly below.
 *
 * The properties under test are all of one shape: a check that cannot run must
 * be LOUD, never quietly counted as a pass.
 *
 * @coordinates-with scripts/lib/dod-assertions.sh — the library under test
 * @coordinates-with scripts/check-feature-ledger-phase.sh — its consumer
 * @module scripts/lib/dod-assertions.test
 */
import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const LIB = path.join(import.meta.dirname, "dod-assertions.sh");
const made = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A temp dir holding `{ "rel": content }`. */
function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "dod-assertions-"));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) writeFileSync(path.join(root, rel), content);
  return root;
}

/**
 * Source the library and run `body`, then print the counters. `PLAN` and
 * `EXEC` are left UNSET unless the caller asks for them — that is one of the
 * conditions under test.
 */
function runBody(body, { cwd, env = {} } = {}) {
  const script = `set -uo pipefail\nsource ${JSON.stringify(LIB)}\n${body}\necho "COUNTS pass=$PASS fail=$FAIL unverified=$UNVERIFIED"\n`;
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...env },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

describe("the grep family — one answer per grep status", () => {
  const root = tree({ "a.txt": "hello | world\n" });

  it("passes and fails on a real match, both fixed and regex", () => {
    const r = runBody(
      [
        `assert_grep 'hello' a.txt 'fixed hit'`,
        `assert_grep 'nope' a.txt 'fixed miss'`,
        `assert_grep_E 'h[ae]llo' a.txt 'regex hit'`,
        `assert_grep_Ei 'HELLO' a.txt 'nocase hit'`,
        `assert_not_grep 'nope' a.txt 'absent hit'`,
        `assert_not_grep 'hello' a.txt 'absent miss'`,
      ].join("\n"),
      { cwd: root },
    );
    expect(r.out).toContain("✓ fixed hit");
    expect(r.out).toContain("✗ fixed miss (text 'nope' not in a.txt)");
    expect(r.out).toContain("✓ regex hit");
    expect(r.out).toContain("✓ nocase hit");
    expect(r.out).toContain("✓ absent hit");
    expect(r.out).toContain("✗ absent miss (stale text 'hello' still in a.txt)");
    expect(r.out).toContain("COUNTS pass=4 fail=2");
  });

  // audit R2 #80/#152 — the POSITIVE wrappers reported "text 'x' not in
  // <file>" for a file that does not exist: a true verdict with a false
  // reason, which sends a reader looking in the wrong place.
  it("says the target is missing rather than blaming the pattern", () => {
    const r = runBody(`assert_grep 'hello' gone.txt 'missing target'`, { cwd: root });
    expect(r.out).toContain("✗ missing target (target missing: gone.txt)");
    expect(r.out).not.toContain("not in gone.txt");
  });

  // grep exits >1 when it could not LOOK. `if grep … else ok` reads that as
  // "the stale text is gone" and passes the phase on evidence it never
  // gathered; `if grep … else fail` reports it as a plain miss. Both are
  // wrong, and both wrappers used to be one of them.
  it.each([
    ["assert_grep_E", "positive"],
    ["assert_not_grep_E", "negative"],
  ])("%s reports an invalid regex as an execution error, not as a %s verdict", (helper) => {
    const r = runBody(`${helper} '[' a.txt 'broken regex'`, { cwd: root });
    expect(r.out).toContain("grep could not look");
    expect(r.out).toContain("✗ broken regex");
    expect(r.out).toContain("COUNTS pass=0 fail=1");
  });
});

describe("assert_exec", () => {
  // audit R2 #157 — an unset EXEC used to abort the whole run from inside an
  // assertion with a bare "EXEC: unbound variable" and no label. A `${EXEC:-0}`
  // default would be worse: every gate would quietly become "unverified".
  it("names the wiring bug when the caller never set EXEC", () => {
    const r = runBody(`assert_exec 'gate' true`);
    expect(r.out).toContain("✗ gate (EXEC is not set by this checker");
    expect(r.out).toContain("COUNTS pass=0 fail=1 unverified=0");
  });

  it("counts the gate as unverified under --no-exec, and green when it passes", () => {
    expect(runBody(`assert_exec 'gate' true`, { env: { EXEC: "0" } }).out).toContain(
      "COUNTS pass=0 fail=0 unverified=1",
    );
    expect(runBody(`assert_exec 'gate' true`, { env: { EXEC: "1" } }).out).toContain(
      "✓ gate (ran green)",
    );
  });

  // audit R2 #158 — the gate's own output IS the diagnostic; discarding it
  // left "exited non-zero: <command>" and nothing to act on.
  it("shows a bounded tail of the failing gate's output", () => {
    const body = `assert_exec 'gate' bash -c 'for i in $(seq 1 40); do echo "line $i"; done; echo "the real error"; exit 3'`;
    const r = runBody(body, { env: { EXEC: "1" } });
    expect(r.out).toContain("✗ gate (exit 3:");
    expect(r.out).toContain("| the real error");
    // Bounded: the head of a long run is not reprinted.
    expect(r.out).not.toContain("| line 1\n");
    expect(r.out).toContain("| line 40");
  });
});

describe("assert_baseline_empty", () => {
  const root = tree({
    "empty.json": JSON.stringify({ entries: [] }),
    "two.json": JSON.stringify({ entries: ["a", "b"] }),
    "broken.json": "{ not json",
  });

  it("passes on an empty baseline and counts a non-empty one", () => {
    const r = runBody(
      `assert_baseline_empty empty.json 'empty'\nassert_baseline_empty two.json 'two'`,
      { cwd: root },
    );
    expect(r.out).toContain("✓ empty (baseline empty)");
    expect(r.out).toContain("✗ two (baseline has 2 entries)");
  });

  // audit R2 #156 — `|| echo "?"` swallowed the parser's message, and the
  // phase then said "baseline has ? entries", which describes neither the
  // failure nor where to look.
  it("reports the parse error instead of claiming '?' entries", () => {
    const r = runBody(`assert_baseline_empty broken.json 'broken'`, { cwd: root });
    expect(r.out).toContain("✗ broken (cannot read broken.json:");
    expect(r.out).not.toContain("? entries");
  });
});

describe("probe / assert_any", () => {
  const root = tree({ "a.txt": "| Mac Option as Meta | On |\n", "b.txt": "plain\n" });

  // audit R2 #159 — the file used to be taken after the FIRST `|`, so a fixed
  // string containing a pipe made the pattern everything before it and the
  // "file" everything after: the probe reported no match for a file it never
  // opened.
  it("matches a fixed pattern that itself contains a pipe", () => {
    const r = runBody(`assert_any 'piped' 'grep|| Mac Option as Meta ||a.txt'`, { cwd: root });
    expect(r.out).toContain("✓ piped");
  });

  it("still splits an ordinary pattern, and nogrep still refuses an unreadable target", () => {
    const r = runBody(
      [
        `assert_any 'hit' 'grep|plain|b.txt'`,
        `assert_any 'absent' 'nogrep|absent-text|b.txt'`,
        `assert_any 'gone' 'nogrep|anything|missing.txt'`,
      ].join("\n"),
      { cwd: root },
    );
    expect(r.out).toContain("✓ hit");
    expect(r.out).toContain("✓ absent");
    expect(r.out).toContain("✗ gone (none of:");
  });

  // A typo'd kind returned 1 like an honest "no", so a sibling probe that
  // happened to pass hid it — the same silence `command_not_found_handle`
  // exists to break for a misspelt helper.
  it.each([
    ["an unknown kind", "grpe|plain|b.txt", "unknown probe kind"],
    ["a grep spec with no file", "grep|plain", "malformed probe spec"],
    ["a file spec with no path", "file|", "malformed probe spec"],
  ])("fails on %s even when a sibling probe would pass", (_label, bad, message) => {
    const r = runBody(`assert_any 'either' ${JSON.stringify(bad)} 'grep|plain|b.txt'`, { cwd: root });
    expect(r.out).toContain(message);
    expect(r.out).toContain("COUNTS pass=0 fail=1");
  });
});
