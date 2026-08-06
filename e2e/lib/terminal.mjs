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
    // The app process itself — not the MCP sidecar, not this node runner.
    if (/\/vmark$|\/VMark$/.test(cmd.stdout.trim())) kept.push(pid);
  }
  return kept;
}

/** The working directory of `pid`, or null when it can't be read. */
async function cwdOf(pid) {
  const out = await run("lsof", ["-a", "-p", pid, "-d", "cwd", "-Fn"]).catch(() => ({ stdout: "" }));
  const line = out.stdout.split("\n").find((l) => l.startsWith("n"));
  return line ? line.slice(1).trim() : null;
}

/**
 * Working directories of every direct child process of the running app — i.e.
 * the shells the terminal spawned. Returns `[{pid, comm, cwd}]`.
 */
export async function getAppShellCwds() {
  const shells = [];
  for (const appPid of await appPids()) {
    const kids = await run("pgrep", ["-P", appPid]).catch(() => ({ stdout: "" }));
    for (const kid of kids.stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
      const comm = (await run("ps", ["-p", kid, "-o", "comm="]).catch(() => ({ stdout: "" }))).stdout.trim();
      const cwd = await cwdOf(kid);
      if (cwd) shells.push({ pid: kid, comm, cwd });
    }
  }
  return shells;
}
