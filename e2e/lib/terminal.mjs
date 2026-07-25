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
 * How many terminal sessions exist (each renders one `.terminal-container`).
 *
 * Counts sessions, NOT running shells: a session whose shell has exited stays in
 * the registry and only respawns on the next keypress
 * (`terminalSessionInputWiring.ts`), and the panel auto-creates a session only
 * when NONE exists. So a lingering dead session silently prevents the fresh
 * spawn that the cwd journey needs to observe.
 */
export function getTerminalSessionCount(client) {
  return evalJs(
    client,
    `(() => document.querySelectorAll(".terminal-sessions-container .terminal-container").length)()`
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
