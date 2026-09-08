/**
 * Journey: terminal-workspace-cwd  (Tier-0 · workspace/terminal integration)
 *
 * Invariant I13 — a terminal session SPAWNS in the workspace root, which is
 * `spawnPty.ts`'s documented first priority ("workspace root > active file's
 * parent > shell default"). A regression is silent and dangerous: the shell
 * lands in `$HOME`, so every relative path the user types — including
 * destructive ones — resolves against the wrong tree.
 *
 * The journey creates its OWN session through the tab bar's `new` action,
 * asserts that session's shell, then closes it. That keeps the assertion
 * repeatable on every run and leaves any session the user already had running
 * untouched — no skip, no killing of live work.
 *
 * WHY THE NEW-PID ASSERTION: VMark reaches "shell cwd == workspace root" by two
 * INDEPENDENT paths — `spawnPty.ts` when a session is created, and
 * `terminalSessionStoreSync.ts`, which writes a `cd` into ALREADY-RUNNING
 * sessions when the root changes (that path is covered by journey 18). A
 * surviving shell therefore satisfies a naive cwd check even if `spawnPty` is
 * completely broken — this journey was observed passing that way during
 * development. Requiring a shell PID that did not exist before the session was
 * created pins the spawn path; a `cd` cannot forge a new pid.
 *
 * Terminal output is unreadable from the harness (WebGL paints to canvas, so no
 * `.xterm-rows`; the helper textarea ignores `execCommand`; the PTY handle is a
 * React ref), so the assertion reads the OS process table instead — see
 * e2e/lib/terminal.mjs. `VMARK_WORKSPACE` stays manual-only (macOS SIP).
 *
 * RAIL NOTE (WI-TS5.2): this journey runs on the runner's rail-off default
 * profile, and its assertion holds under the rail too — a scoped session's
 * spawn cwd is its owner workspace's root, the same directory. Journey 35
 * (terminal-rail-scoping) covers the rail-ON contract.
 *
 * Safety:
 *   - Creates and closes only its OWN session; pre-existing sessions are never
 *     touched, and the panel is returned to its prior visibility.
 *   - If a workspace is already open it is used READ-ONLY; a temp workspace is
 *     created only when none is open, then closed and removed in teardown.
 *   - Touches no tabs and no documents.
 */

import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersistedWorkspaceRoot, poll } from "../lib/vmark.mjs";
import { openWorkspaceViaMcp, closeWorkspace } from "../lib/workspace.mjs";
import { getRailInstances, restoreRail } from "../lib/rail.mjs";
import {
  isTerminalOpen,
  openTerminal,
  closeTerminal,
  getAppShellCwds,
  getTerminalSessions,
  canCreateSession,
  createTerminalSession,
  closeActiveTerminalSession,
} from "../lib/terminal.mjs";

export default {
  name: "terminal-workspace-cwd",

  // Backs a ✅-automated Tier-0 row (I13) and creates its own session, so it has
  // no environmental reason to skip. If it ever does, the runner fails the suite
  // rather than let a green summary imply coverage that did not run.
  coverageRequired: true,

  async run(client, ctx) {
    const terminalWasOpen = await isTerminalOpen(client);
    const existingRoot = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    // The rail as found. On a rail-on profile, open_workspace below ADDS an
    // instance and activates it; teardown must take that back and prove it
    // (restoreRail) — until 2026-09-07 the menu close left it registered and
    // active with no root, after which no later journey could see a document
    // tab.
    const railBefore = await getRailInstances(client);
    let tempDir = null;
    let root = existingRoot;
    let createdSession = false;
    let bodyError = null;
    // Infinity until measured: if the body fails before the terminal is
    // touched, teardown must not close sessions in a scope that is not ours.
    let sessionsBaseline = Infinity;

    try {
      if (!root) {
        // No workspace open — create one and exercise the real approval flow.
        tempDir = await mkdtemp(join(homedir(), ".vmark-e2e-ws-"));
        await writeFile(join(tempDir, "readme.md"), "# e2e workspace\n", "utf8");
        root = await openWorkspaceViaMcp(client, tempDir, { windowLabel: ctx.windowLabel });
        ctx.log(`workspace opened via open_workspace approval flow: ${root}`);
      } else {
        ctx.log(`using the already-open workspace read-only: ${root}`);
      }

      // Sessions visible in this scope BEFORE the terminal is touched. Under the
      // rail, opening the terminal in an empty scope AUTO-CREATES a session
      // (journey 35 relies on it); it is this journey's to dispose of, and the
      // rail close in teardown does not kill a scope's PTYs — an undisposed one
      // became a window-scoped leftover that made journey 35 skip on every
      // rail-on run. Everything above this count is closed in teardown.
      sessionsBaseline = (await getTerminalSessions(client)).total;
      await openTerminal(client, ctx.windowLabel);

      // The session cap is a real product limit, not a harness limitation.
      if (!(await canCreateSession(client))) {
        const s = await getTerminalSessions(client);
        return { skip: `terminal session cap reached (${s.total} open) — cannot create one to assert on` };
      }

      const pidsBefore = new Set((await getAppShellCwds()).map((s) => s.pid));
      await createTerminalSession(client);
      createdSession = true;
      ctx.log("created a dedicated terminal session");

      const shells = await poll(
        () => getAppShellCwds(),
        (list) => list.some((s) => !pidsBefore.has(s.pid) && s.cwd === root),
        `a NEWLY spawned terminal shell with cwd === ${root}`,
        { timeoutMs: 15000, intervalMs: 500 }
      );
      const match = shells.find((s) => !pidsBefore.has(s.pid) && s.cwd === root);
      ctx.log(`newly spawned shell ${match.comm} (pid ${match.pid}) has cwd ${match.cwd}`);
    } catch (err) {
      bodyError = err;
      throw err;
    } finally {
      // Dispose only what this journey created, then restore panel visibility.
      if (createdSession) await closeActiveTerminalSession(client).catch(() => {});
      if (tempDir) {
        // The scope is this journey's own (it opened the workspace): close the
        // rest of what opening the terminal here created, down to the baseline.
        for (let i = 0; i < 8; i++) {
          const remaining = await getTerminalSessions(client).catch(() => null);
          if (!remaining || remaining.total <= sessionsBaseline) break;
          await closeActiveTerminalSession(client).catch(() => {});
        }
      }
      if (!terminalWasOpen) await closeTerminal(client, ctx.windowLabel).catch(() => {});
      if (tempDir) {
        // The menu close first — the product path, which under the rail removes
        // the active instance (workspaceCommands.ts) — then the rail restore for
        // anything it did not reach, ending in the identity check. A restore
        // failure is LOUD when the body succeeded (R2-17): a silently leaked
        // instance is what this teardown exists to prevent.
        await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
        try {
          await restoreRail(client, railBefore);
        } catch (restoreErr) {
          if (!bodyError) throw restoreErr;
          ctx.log(`warning: rail restore failed after a body error: ${restoreErr?.message ?? restoreErr}`);
        }
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
};
