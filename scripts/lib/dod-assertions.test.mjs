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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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
  // Bounded: a transport that deadlocks must fail the case, not hang the tier.
  const r = spawnSync("bash", ["-c", script], {
    encoding: "utf8",
    cwd,
    env: { ...process.env, ...env },
    timeout: 60_000,
    killSignal: "SIGKILL",
  });
  // A timeout lands in `error` while `status` may still be bash's own exit
  // code (bash exited; a descendant held the pipes). Thrown, so it fails.
  if (r.error) throw r.error;
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

// WI-RA28.1 — a Rust test that the directory-module file `<dir>.rs` mounts as
// `#[path = "<dir>/x.test.rs"]` is compiled; `src-tauri/src/pty.rs` mounts its
// commands, lifecycle and support tests that way.
describe("assert_test_file — a test mounted from the directory-module file", () => {
  function crate(ptyRs) {
    const root = mkdtempSync(path.join(tmpdir(), "dod-assertions-mount-"));
    made.push(root);
    mkdirSync(path.join(root, "pty"));
    writeFileSync(path.join(root, "lib.rs"), "mod pty;\n");
    writeFileSync(path.join(root, "pty.rs"), ptyRs);
    writeFileSync(path.join(root, "pty/commands.test.rs"), "#[test]\nfn runs() {}\n");
    return root;
  }

  it("passes when <dir>.rs actively mounts <dir>/x.test.rs", () => {
    const r = runBody("assert_test_file pty/commands.test.rs 'mounted test'", {
      cwd: crate('#[cfg(test)]\n#[path = "pty/commands.test.rs"]\nmod commands_tests;\n'),
    });
    expect(r.out).toContain("✓ mounted test (included from pty.rs)");
    expect(r.out).toContain("COUNTS pass=1 fail=0");
  });

  it("still fails when that mount is commented out", () => {
    const r = runBody("assert_test_file pty/commands.test.rs 'mounted test'", {
      cwd: crate('// #[path = "pty/commands.test.rs"]\n// mod commands_tests;\n'),
    });
    expect(r.out).toContain("COUNTS pass=0 fail=1");
  });
});

// WI-AL2.0g — a Rust test that a child directory's module mounts as
// `#[path = "../x.test.rs"]` is compiled; `src-tauri/src/agent_journal/admission/mod.rs`
// mounts the admission, request and page tests beside its directory that way.
describe("assert_test_file — a test mounted from a child directory's module", () => {
  function crate(modRs) {
    const root = mkdtempSync(path.join(tmpdir(), "dod-assertions-child-mount-"));
    made.push(root);
    mkdirSync(path.join(root, "admission"));
    writeFileSync(path.join(root, "mod.rs"), "mod admission;\n");
    writeFileSync(path.join(root, "admission/mod.rs"), modRs);
    writeFileSync(path.join(root, "page_lifecycle.test.rs"), "#[test]\nfn runs() {}\n");
    return root;
  }

  it("passes when <child>/mod.rs actively mounts ../x.test.rs", () => {
    const r = runBody("assert_test_file page_lifecycle.test.rs 'mounted test'", {
      cwd: crate('#[cfg(test)]\n#[path = "../page_lifecycle.test.rs"]\nmod page_lifecycle_tests;\n'),
    });
    expect(r.out).toContain("✓ mounted test (included from mod.rs)");
    expect(r.out).toContain("COUNTS pass=1 fail=0");
  });

  it("names the child module as the owner, so the cargo filter is that module's path", () => {
    const r = runBody('rust_mount_owner page_lifecycle.test.rs; echo "owner=$_DOD_MOUNT"', {
      cwd: crate('#[cfg(test)]\n#[path = "../page_lifecycle.test.rs"]\nmod page_lifecycle_tests;\n'),
    });
    expect(r.out).toContain("owner=./admission/mod.rs");
  });

  it("still fails when that mount is commented out", () => {
    const r = runBody("assert_test_file page_lifecycle.test.rs 'mounted test'", {
      cwd: crate('// #[path = "../page_lifecycle.test.rs"]\n// mod page_lifecycle_tests;\n'),
    });
    expect(r.out).toContain("COUNTS pass=0 fail=1");
  });

  it("fails when the child mounts a different file of the same name one level further up", () => {
    const r = runBody("assert_test_file page_lifecycle.test.rs 'mounted test'", {
      cwd: crate('#[cfg(test)]\n#[path = "../../page_lifecycle.test.rs"]\nmod page_lifecycle_tests;\n'),
    });
    expect(r.out).toContain("COUNTS pass=0 fail=1");
  });
});

// ---------------------------------------------------------------- the --serve transport (audit 2026-09-28)
// `dod_syntax` answers from one long-lived server per shell. Every case below
// is a way the transport could hand back a WRONG answer while looking fine —
// the probe results themselves must match what a fresh process says.
describe("dod_syntax over the server transport", () => {
  const root = tree({ "yes.test.ts": 'it("runs", () => {});\n', "no.test.ts": "// it(\"planned\", () => {});\n" });
  const verdicts = (out) => Object.fromEntries([...out.matchAll(/^(\w+)=(\d+)$/gm)].map((m) => [m[1], Number(m[2])]));

  it("gives concurrent subshells their OWN answers — a pipeline stage or background job never shares the stream", () => {
    const body = `has_test_case yes.test.ts; echo "warm=$?"
for i in 1 2 3 4 5 6 7 8; do
  ( has_test_case yes.test.ts; echo "y$i=$?" ) &
  ( has_test_case no.test.ts; echo "n$i=$?" ) &
done
wait
has_test_case no.test.ts; echo "after=$?"`;
    const v = verdicts(runBody(body, { cwd: root }).out);
    expect(v.warm).toBe(0);
    for (let i = 1; i <= 8; i++) {
      expect(v[`y${i}`], `y${i}`).toBe(0);
      expect(v[`n${i}`], `n${i}`).toBe(1);
    }
    expect(v.after).toBe(1);
  });

  it("never makes a caller's own `wait` block on the server", () => {
    // bash 5.2 (Ubuntu CI) has a bare `wait` also wait for a LIVE process
    // substitution; a server started as one never exits while the shell
    // lives, so a DoD script that waited on its own jobs hung forever.
    const body = `has_test_case yes.test.ts; echo "warm=$?"
( true ) &
wait; echo "waited=0"
has_test_case no.test.ts; echo "after=$?"`;
    const v = verdicts(runBody(body, { cwd: root }).out);
    expect(v).toEqual({ warm: 0, waited: 0, after: 1 });
  });

  it("answers correctly from a working directory whose name holds a carriage return, and stays in step afterwards", () => {
    const odd = path.join(root, "a\rb");
    mkdirSync(odd, { recursive: true });
    writeFileSync(path.join(odd, "here.test.ts"), 'it("runs", () => {});\n');
    const body = `has_test_case yes.test.ts; echo "warm=$?"
cd "a"$'\\r'"b" && { has_test_case here.test.ts; echo "odd=$?"; cd - >/dev/null; }
has_test_case no.test.ts; echo "after=$?"
has_test_case yes.test.ts; echo "again=$?"`;
    expect(verdicts(runBody(body, { cwd: root }).out)).toEqual({ warm: 0, odd: 0, after: 1, again: 0 });
  });

  it("falls back to a fresh process when the server dies, for this probe and every later one", () => {
    const body = `has_test_case yes.test.ts; echo "warm=$?"
kill "$_DOD_PID" 2>/dev/null; sleep 0.3
dod_syntax ts-has-test-case yes.test.ts; echo "first=$?"
has_test_case no.test.ts; echo "second=$?"`;
    const r = runBody(body, { cwd: root });
    expect(verdicts(r.out)).toEqual({ warm: 0, first: 0, second: 1 });
    expect(r.out).toMatch(/--serve stopped answering/);
  });

  // A server that dies before it answers must end the handshake at once. While
  // the reader still held its own read-write descriptor, that death was not
  // end-of-file, and every shell whose server failed to start sat out the whole
  // 60-second ping timeout before falling back.
  it("gives up at once on a server that dies before it answers", () => {
    writeFileSync(path.join(root, "dies.mjs"), "process.exit(3);\n");
    const body = `DOD_SYNTAX="$PWD/dies.mjs"
SECONDS=0
has_test_case yes.test.ts; echo "probe=$?"
echo "state=$_DOD_STATE elapsed=$SECONDS"`;
    const r = runBody(body, { cwd: root });
    expect(r.out).toContain("probe=3"); // the fresh-process fallback ran the (dying) probe script
    expect(r.out).toMatch(/state=off elapsed=\d+/);
    expect(Number(/elapsed=(\d+)/.exec(r.out)[1]), r.out).toBeLessThan(30);
  });

  it("leaves a caller's own descriptors 7 and 8 alone", () => {
    const body = `exec 7>seven.txt 8>eight.txt
has_test_case yes.test.ts; echo "probe=$?"
echo kept7 >&7; echo kept8 >&8
exec 7>&- 8>&-`;
    expect(verdicts(runBody(body, { cwd: root }).out)).toEqual({ probe: 0 });
    expect(readFileSync(path.join(root, "seven.txt"), "utf8")).toBe("kept7\n");
    expect(readFileSync(path.join(root, "eight.txt"), "utf8")).toBe("kept8\n");
  });
});

// ---------------------------------------------------------------- nothing outlives the checker (#1473)
// The checker EXITED, yet a caller reading its output never saw end-of-file:
// `check-feature-ledger-phase.test.mjs` hung the gate tier. In bash 3.2 — the
// bash macOS ships — the reader's blocking open of the reply FIFO fails with
// EINTR when a child exits meanwhile; the server's write-only open then waited
// for ever, in a forked shell still holding the caller's stdout and stderr
// (bash parks them at fd 10+ while `has_test_case … >/dev/null 2>&1` runs).
// That race hit about 1 run in 17 under 8-way load. A FIFO created write-only
// makes "the reader never opens" CERTAIN, on every bash, so the invariant is
// pinned deterministically rather than by hoping to lose the race.
describe("a reply FIFO whose reader never opens leaves nothing behind", () => {
  // `bash` as a test would find it, and the system one when that differs —
  // on macOS the system bash is 3.2, the one that actually loses the race.
  const bashes = [...new Map(
    [execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim(), "/bin/bash"]
      .filter((b) => b && existsSync(b))
      .map((b) => [realpathSync(b), b]),
  ).values()];

  /**
   * Every live process in process group `pgid`. The checker is spawned
   * detached, so it leads a new group that every descendant inherits — a
   * forked shell and the node server alike (none of them calls setsid).
   */
  const groupMembers = (pgid) =>
    execFileSync("ps", ["-A", "-o", "pid=,pgid="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([pid, group]) => group === pgid && pid !== pgid)
      .map(([pid]) => pid);

  /** The group's members once exits in flight have settled; only a stuck process is still there after 2s. */
  const survivorsOf = async (pgid) => {
    let left = groupMembers(pgid);
    for (let i = 0; i < 20 && left.length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      left = groupMembers(pgid);
    }
    return left;
  };

  // The forcing is a permission (a write-only FIFO), which root does not obey.
  it.skipIf(process.getuid?.() === 0).each(bashes)("%s: the caller's output ends, the fallback answers, and no process survives", async (bash) => {
    const dir = tree({ "yes.test.ts": 'it("runs", () => {});\n' });
    const script = [
      "set -uo pipefail",
      `source ${JSON.stringify(LIB)}`,
      // Shadow mkfifo: the reply FIFO is created write-only, so no read open succeeds.
      'mkfifo() { command mkfifo -m 0200 "$@"; }',
      'has_test_case yes.test.ts; echo "probe=$?"',
      'echo "state=$_DOD_STATE"',
    ].join("\n");
    // stdin is a pipe that is never written to or closed, as under `sleep 999 | …`:
    // the reported shape. The watchdog makes a regression FAIL rather than hang.
    const child = spawn(bash, ["-c", script], { cwd: dir, stdio: ["pipe", "pipe", "pipe"], detached: true });
    try {
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      const ended = await new Promise((resolve) => {
        const watchdog = setTimeout(() => resolve(false), 30_000);
        child.on("close", () => {
          clearTimeout(watchdog);
          resolve(true);
        });
      });
      const left = await survivorsOf(child.pid);

      expect(ended, `the checker's output never reached end-of-file under ${bash}:\n${out}`).toBe(true);
      expect(left, `processes outlived the checker under ${bash}`).toEqual([]);
      expect(out).toContain("probe=0"); // the fresh-process fallback still answers
      expect(out).toContain("state=off");
    } finally {
      child.stdin.destroy();
      try {
        process.kill(-child.pid, "SIGKILL"); // whatever of the group is left
      } catch {
        // ESRCH: the group is already empty
      }
    }
  });

  // The other direction: the caller leaves while the server is still writing.
  // A server that could READ its own reply FIFO (an open of it read-write)
  // never got EPIPE — it blocked for ever on a reply nobody would read, with
  // the pipe buffer full. Only a write-only server dies with its caller.
  it.each(bashes)("%s: a server whose caller leaves mid-reply exits instead of blocking on it", async (bash) => {
    const long = path.join(tree({ "yes.test.ts": 'it("runs", () => {});\n' }), "d".repeat(200));
    mkdirSync(long);
    writeFileSync(path.join(long, "a.rs"), "fn x() {}\n");
    const script = [
      "set -uo pipefail",
      `source ${JSON.stringify(LIB)}`,
      `cd ${JSON.stringify(path.dirname(long))}`,
      'has_test_case yes.test.ts >/dev/null 2>&1; echo "state=$_DOD_STATE server=$_DOD_PID"',
      // 3,000 matches of one 200-character path: ~690 KB of reply, far past any pipe buffer.
      `files=(); for i in $(seq 1 3000); do files+=(${JSON.stringify(path.join(long, "a.rs"))}); done`,
      `( IFS=$'\\x1f'; printf '%s\\n' "$PWD"$'\\x1f'"rust-code-grep"$'\\x1f'"fn"$'\\x1f'"\${files[*]}" ) >&"$_DOD_IN"`,
      "exit 0", // without reading a byte of the reply
    ].join("\n");
    const child = spawn(bash, ["-c", script], { stdio: ["pipe", "pipe", "pipe"], detached: true });
    try {
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      const ended = await new Promise((resolve) => {
        const watchdog = setTimeout(() => resolve(false), 60_000);
        child.on("close", () => {
          clearTimeout(watchdog);
          resolve(true);
        });
      });
      expect(ended, `the caller's output never reached end-of-file under ${bash}:\n${out}`).toBe(true);
      const server = Number(/server=(\d+)/.exec(out)?.[1]);
      expect(out, "the server must have been up for this to test anything").toContain("state=up");
      expect(Number.isInteger(server) && server > 0).toBe(true);

      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 100 && alive(server); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alive(server), `the server outlived its caller under ${bash}, blocked on an unread reply`).toBe(false);
    } finally {
      child.stdin.destroy();
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // ESRCH: the group is already empty
      }
    }
  });

  // A background job the checking shell leaves behind inherits the write end
  // of the server's request pipe, so end-of-file never reaches the server and
  // it outlived the shell for as long as that job ran.
  it.each(bashes)("%s: the server exits with its shell, even while a background job of that shell holds the request pipe", async (bash) => {
    const dir = tree({ "yes.test.ts": 'it("runs", () => {});\n' });
    const script = [
      "set -uo pipefail",
      `source ${JSON.stringify(LIB)}`,
      `cd ${JSON.stringify(dir)}`,
      'has_test_case yes.test.ts >/dev/null 2>&1; echo "state=$_DOD_STATE server=$_DOD_PID"',
      'sleep 60 </dev/null >/dev/null 2>&1 & echo "job=$!"',
      "exit 0",
    ].join("\n");
    const child = spawn(bash, ["-c", script], { stdio: ["pipe", "pipe", "pipe"], detached: true });
    try {
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk));
      child.stderr.on("data", (chunk) => (out += chunk));
      // Bounded, so a hung child fails the case and still reaches `finally`.
      const ended = await new Promise((resolve) => {
        const watchdog = setTimeout(() => resolve(false), 60_000);
        child.on("close", () => {
          clearTimeout(watchdog);
          resolve(true);
        });
      });
      expect(ended, `the shell's output never reached end-of-file under ${bash}:\n${out}`).toBe(true);
      const server = Number(/server=(\d+)/.exec(out)?.[1]);
      const job = Number(/job=(\d+)/.exec(out)?.[1]);
      expect(out, "the server must have been up for this to test anything").toContain("state=up");
      expect(Number.isInteger(server) && server > 0 && Number.isInteger(job) && job > 0, out).toBe(true);

      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      expect(alive(job), "the background job must still hold the pipe for this to test anything").toBe(true);
      for (let i = 0; i < 100 && alive(server); i++) await new Promise((resolve) => setTimeout(resolve, 100));
      expect(alive(server), `the server outlived its shell under ${bash}`).toBe(false);
    } finally {
      child.stdin.destroy();
      try {
        process.kill(-child.pid, "SIGKILL"); // the background job, and a server that did not leave
      } catch {
        // ESRCH: the group is already empty
      }
    }
  });
});
