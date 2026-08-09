/**
 * Terminal helpers for the E2E journey suite.
 *
 * WHY THE ASSERTION IS OS-LEVEL, NOT DOM-LEVEL: the terminal renders through
 * the WebGL addon (src/components/Terminal/setupWebglRenderer.ts), so xterm
 * paints to a canvas and `.xterm-rows` does NOT exist — terminal output is
 * unreadable from the DOM. Synthetic input is equally unavailable: the helper
 * textarea ignores `execCommand("insertText")` (verified live), and the PTY
 * session handle lives in a React ref, not on `window`.
 *
 * What IS observable is the thing that actually matters. `spawnPty.ts` documents
 * "CWD priority: workspace root > active file's parent > shell default", and the
 * spawned shell is a real child process — so its working directory can be read
 * straight from the OS. That asserts the shipped contract end-to-end (workspace
 * → PTY spawn → real shell cwd) without depending on renderer internals.
 *
 * Not assertable here: `VMARK_WORKSPACE`. macOS restricts reading another
 * process's environment (`ps eww` shows nothing under SIP), so that half of the
 * spawn contract stays manual-only — recorded in dev-docs/e2e-tier0-matrix.md.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { evalJs } from "./bridge.mjs";
import { emitMenu, poll } from "./vmark.mjs";

const run = promisify(execFile);

const TERMINAL_PANEL = ".terminal-panel";

/**
 * Is the terminal panel currently VISIBLE?
 *
 * Mounted ≠ open: `TerminalPanel` latches xterm on first show and thereafter
 * hides with `display: none` rather than unmounting (so the shell survives a
 * toggle). Presence of `.terminal-container` is therefore permanently true once
 * the terminal has ever been opened — the visibility of `.terminal-panel` is the
 * only honest signal.
 */
export function isTerminalOpen(client) {
  return evalJs(
    client,
    `(() => {
       const p = document.querySelector(${JSON.stringify(TERMINAL_PANEL)});
       return !!p && getComputedStyle(p).display !== "none";
     })()`
  );
}

/**
 * Snapshot the session tabs: `{total, alive, dead}`.
 *
 * Session ≠ running shell. A session whose shell exited stays in the registry
 * (rendered with `terminal-tab-dead`) and respawns only on the next keypress
 * (`terminalSessionInputWiring.ts`), while still suppressing the panel's
 * auto-create. Counting `.terminal-container` alone is alive-BLIND and cannot
 * tell "no sessions" from "one dead session" — a distinction that decides
 * whether opening the terminal will spawn anything at all.
 */
export function getTerminalSessions(client) {
  return evalJs(
    client,
    `(() => {
       const tabs = [...document.querySelectorAll(".terminal-tab-bar-tabs .terminal-tab")];
       const dead = tabs.filter((t) => t.classList.contains("terminal-tab-dead")).length;
       return { total: tabs.length, alive: tabs.length - dead, dead };
     })()`
  );
}

/** Is the "new session" button available (i.e. below MAX_TERMINAL_SESSIONS)? */
export function canCreateSession(client) {
  return evalJs(
    client,
    `(() => {
       const b = document.querySelector('[data-terminal-action="new"]');
       return !!b && !b.disabled;
     })()`
  );
}

/** Click one of the tab-bar's stable automation hooks. */
function clickAction(client, action) {
  return evalJs(
    client,
    `(() => {
       const b = document.querySelector('[data-terminal-action=${JSON.stringify(action)}]');
       if (!b) return false;
       b.click();
       return true;
     })()`
  );
}

/**
 * Create a NEW terminal session and resolve once its tab exists. Returns the
 * session count before creation so the caller can dispose exactly what it made.
 */
export async function createTerminalSession(client) {
  const before = await getTerminalSessions(client);
  if (!(await clickAction(client, "new"))) {
    throw new Error('no [data-terminal-action="new"] button — terminal tab bar not rendered');
  }
  await poll(
    () => getTerminalSessions(client),
    (s) => s.total === before.total + 1,
    `terminal session count to reach ${before.total + 1}`
  );
  return before.total;
}

/** Close the ACTIVE terminal session and wait for its tab to disappear. */
export async function closeActiveTerminalSession(client) {
  const before = await getTerminalSessions(client);
  if (before.total === 0) return;
  await clickAction(client, "close");
  await poll(
    () => getTerminalSessions(client),
    (s) => s.total === before.total - 1,
    `terminal session count to drop to ${before.total - 1}`
  );
}

/** Toggle the terminal panel (the same event the native menu emits). */
export function toggleTerminal(client, windowLabel = "main") {
  return emitMenu(client, "toggle-terminal", windowLabel);
}

/** Open the terminal and wait for the panel to mount. */
export async function openTerminal(client, windowLabel = "main") {
  if (await isTerminalOpen(client)) return;
  await toggleTerminal(client, windowLabel);
  await poll(() => isTerminalOpen(client), (open) => open === true, "terminal panel to mount");
}

/** Close the terminal and wait for the panel to unmount. */
export async function closeTerminal(client, windowLabel = "main") {
  if (!(await isTerminalOpen(client))) return;
  await toggleTerminal(client, windowLabel);
  await poll(() => isTerminalOpen(client), (open) => open === false, "terminal panel to unmount");
}

/** PIDs of the running VMark app (debug binary or installed bundle). */
async function appPids() {
  const out = await run("pgrep", ["-f", "vmark"]).catch(() => ({ stdout: "" }));
  const pids = out.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
  const kept = [];
  for (const pid of pids) {
    const cmd = await run("ps", ["-p", pid, "-o", "comm="]).catch(() => ({ stdout: "" }));
    // Compare the BASENAME. `ps -o comm=` prints the full executable path on
    // macOS but only the command NAME on Linux, so the original `/vmark$`
    // pattern — which requires a leading slash — matched nothing on a runner
    // and appPids() came back empty. That is the second half of the same
    // platform assumption as cwdOf: the harness looked, saw nothing, and
    // reported it as an app that spawns no shells.
    const name = cmd.stdout.trim().split("/").pop();
    // The app process itself — not the MCP sidecar, not this node runner.
    if (name === "vmark" || name === "VMark") kept.push(pid);
  }
  return kept;
}

/**
 * The working directory of `pid`, or null when the process has none we can see
 * (it exited, or it is not ours).
 *
 * PLATFORM: Linux exposes this as `/proc/<pid>/cwd`, always present, no tools
 * required. macOS has no procfs, so it needs `lsof`.
 *
 * This used to be lsof-only. `lsof` is NOT installed on GitHub's ubuntu
 * runners, and the `.catch()` turned "the tool is missing" into "this process
 * has no cwd" — so every shell was dropped, `getAppShellCwds()` returned `[]`,
 * and both terminal journeys timed out reporting `last observed: []`. The
 * journeys were macOS-only by accident, and the accident was a silent fallback.
 * `probeUnavailable` below makes the missing-tool case loud instead.
 */
async function cwdOf(pid) {
  if (process.platform === "linux") {
    const out = await run("readlink", ["-f", `/proc/${pid}/cwd`]).catch(() => ({ stdout: "" }));
    const cwd = out.stdout.trim();
    return cwd || null;
  }
  const out = await run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).catch(() => ({ stdout: "" }));
  const line = out.stdout.split("\n").find((l) => l.startsWith("n"));
  return line ? line.slice(1).trim() : null;
}

/**
 * Is the cwd probe usable at all on this machine? Distinguishes "no shells are
 * running" from "this harness cannot see shells" — two states that produced an
 * identical empty array before, and one of which is a broken harness reporting
 * a broken app.
 */
async function probeUnavailable() {
  const self = String(process.pid);
  const cwd = await cwdOf(self);
  if (cwd) return null;
  return process.platform === "linux"
    ? "cannot read /proc/<pid>/cwd — is this a Linux container without procfs?"
    : "`lsof` is unavailable, and this platform has no /proc to fall back on";
}

/**
 * Working directories of every direct child process of the running app — i.e.
 * the shells the terminal spawned. Returns `[{pid, comm, cwd}]`.
 */
export async function getAppShellCwds() {
  // Assert the instrument before trusting its reading. An empty result must
  // mean "no shells", never "no way to look" — conflating those is what made a
  // missing `lsof` present as an app that never spawns a terminal.
  const broken = await probeUnavailable();
  if (broken) throw new Error(`cannot observe process working directories: ${broken}`);

  // The caller reached us over the app's own automation bridge, so the app is
  // running by construction. Finding no app process means the PROBE is wrong,
  // not that the app vanished — and an empty shell list would otherwise blame
  // the app for it.
  const apps = await appPids();
  if (apps.length === 0) {
    throw new Error(
      "no running app process matched — `pgrep -f vmark` + `ps -o comm=` found nothing, " +
        "yet the bridge answered. The process-name probe is broken, not the app.",
    );
  }

  const shells = [];
  for (const appPid of apps) {
    const kids = await run("pgrep", ["-P", appPid]).catch(() => ({ stdout: "" }));
    for (const kid of kids.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const comm = (await run("ps", ["-p", kid, "-o", "comm="]).catch(() => ({ stdout: "" }))).stdout.trim();
      const cwd = await cwdOf(kid);
      if (cwd) shells.push({ pid: kid, comm, cwd });
    }
  }
  return shells;
}
