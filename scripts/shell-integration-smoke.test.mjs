// WI-FL5.11 — the zsh and bash integrations are EXECUTED by real shells under a
// pseudo-terminal, and must emit the OSC 133 / OSC 7 sequences VMark's terminal
// parses. `src-tauri/src/shell_integration.test.rs` asserts the scripts' TEXT
// (the marks are present, the user's rc is sourced first); nothing ran them, so
// a syntax error or a hook that never fires would ship green. This test lives
// in the gates tier, which CI runs on ubuntu-latest (`fe-static` → `test:gates`),
// so it is the "Linux job that starts each shell" the plan asks for, and it
// also runs on macOS where the same two shells are present.
//
// Mechanism: scripts/lib/ptyRun.py forks the shell under a pty (Python's pty
// module, present on every macOS and ubuntu runner) and types `true`, `false`,
// `exit` exactly as a user would; the transcript is what a terminal emulator
// would see. `script(1)` was tried first and rejected: BSD `script` hands a
// non-tty stdin to the shell as an immediate EOT, so the marks never fire.
// A missing python3 or shell is a FAILURE, not a skip: the point is to run.
// Windows has neither, and the gates tier is not run there.
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const RESOURCES = join(ROOT, "src-tauri/resources/shell-integration");
const ESC = "";
const BEL = "";
const osc = (body) => `${ESC}]${body}${BEL}`;

function which(bin) {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

const PTY_DRIVER = join(ROOT, "scripts/lib/ptyRun.py");

/**
 * Run `argv` interactively inside a pty, typing `input`, and return the
 * transcript. `env` is the WHOLE environment: a scratch HOME with no rc files,
 * so the machine's real shell configuration cannot mask or add marks.
 */
function runInPty(argv, { env, input, cwd }) {
  if (!which("python3")) throw new Error("python3 is not installed; the pty driver needs it");
  const r = spawnSync("python3", [PTY_DRIVER, "--cwd", cwd, "--input", input, "--timeout", "15", "--", ...argv], {
    env,
    encoding: "latin1",
    timeout: 30_000,
  });
  if (r.error) throw r.error;
  if (r.status === 124) throw new Error(`shell did not exit within the pty timeout; transcript so far:\n${r.stdout}`);
  return r.stdout;
}

function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vmark-shell-")));
  const home = join(dir, "home");
  const cwd = join(dir, "work dir"); // a space: the OSC 7 path must survive it
  mkdirSync(home);
  mkdirSync(cwd);
  return { dir, home, cwd };
}

const baseEnv = (home) => ({
  HOME: home,
  PATH: process.env.PATH,
  TERM: "xterm-256color",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
});

const INPUT = "true\nfalse\nexit\n";

function expectMarks(transcript, cwd, shell) {
  const where = `${shell} transcript:\n${JSON.stringify(transcript.slice(0, 600))}`;
  expect(transcript, where).toContain(osc("133;A"));
  expect(transcript, where).toContain(osc("133;C"));
  expect(transcript, where).toContain(osc("133;D;0"));
  expect(transcript, where).toContain(osc("133;D;1"));
  // OSC 7 carries the cwd; the space is percent-encoded downstream by the
  // consumer, the shell sends it raw, so match on the directory name.
  expect(transcript, where).toMatch(new RegExp(`${ESC}\\]7;file://[^${BEL}]*${basename(cwd)}${BEL}`));
  // Order for one command line: prompt-start, then pre-exec, then done.
  const a = transcript.indexOf(osc("133;A"));
  const c = transcript.indexOf(osc("133;C"), a);
  const d = transcript.indexOf(osc("133;D;0"), c);
  expect(a, where).toBeGreaterThanOrEqual(0);
  expect(c, where).toBeGreaterThan(a);
  expect(d, where).toBeGreaterThan(c);
}

describe.skipIf(platform() === "win32")("shell integration runs in a real shell (WI-FL5.11)", () => {
  it("zsh: ZDOTDIR points at the materialised .zshrc, and every command gets A/C/D marks plus OSC 7", () => {
    expect(which("zsh"), "zsh must be installed where the gates tier runs").not.toBeNull();
    const { dir, home, cwd } = scratch();
    const zdotdir = join(dir, "zsh");
    mkdirSync(zdotdir);
    copyFileSync(join(RESOURCES, "vmark.zsh"), join(zdotdir, ".zshrc"));
    const transcript = runInPty(["zsh", "-i"], {
      env: { ...baseEnv(home), ZDOTDIR: zdotdir },
      input: INPUT,
      cwd,
    });
    expectMarks(transcript, cwd, "zsh");
  });

  it("bash: --rcfile loads the integration, and every command gets A/C/D marks plus OSC 7", () => {
    expect(which("bash"), "bash must be installed where the gates tier runs").not.toBeNull();
    const { dir, home, cwd } = scratch();
    const rc = join(dir, "vmark.bash");
    copyFileSync(join(RESOURCES, "vmark.bash"), rc);
    const transcript = runInPty(["bash", "--rcfile", rc, "-i"], {
      env: baseEnv(home),
      input: INPUT,
      cwd,
    });
    expectMarks(transcript, cwd, "bash");
  });

  it("bash: a DEBUG trap and PROMPT_COMMAND installed by the user's rc keep running", () => {
    // Composition, not replacement: the script must call the prior trap and
    // prompt command, or bash-preexec/direnv/atuin users lose them silently.
    const { dir, home, cwd } = scratch();
    const rc = join(dir, "vmark.bash");
    copyFileSync(join(RESOURCES, "vmark.bash"), rc);
    writeFileSync(join(home, ".bashrc"), "trap 'printf USER_DEBUG_RAN' DEBUG\nPROMPT_COMMAND='printf USER_PROMPT_RAN'\n");
    const transcript = runInPty(["bash", "--rcfile", rc, "-i"], { env: baseEnv(home), input: INPUT, cwd });
    expect(transcript).toContain("USER_PROMPT_RAN");
    expect(transcript).toContain("USER_DEBUG_RAN");
    expectMarks(transcript, cwd, "bash+user rc");
  });
});
