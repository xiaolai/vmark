/**
 * Journey: terminal-workspace-cd-sync  (Tier-0 · workspace/terminal integration)
 *
 * Invariant I15 — when the workspace root changes while a terminal session is
 * ALREADY RUNNING, that live shell is redirected to the new root
 * (`terminalSessionStoreSync.ts` writes a `cd` into the running PTY). This is
 * the path users actually hit: the terminal is already open when they switch
 * projects. If it breaks, the shell keeps operating in the PREVIOUS project's
 * tree while the UI claims the new one — the most dangerous possible
 * disagreement between what is displayed and where commands land.
 *
 * I15 is explicitly the LEGACY / WINDOW-SCOPED cd-follow (WI-TS5.2): with the
 * workspace rail ON, sessions are scoped per workspace and a switch HIDES
 * them instead of cd'ing (journey 35, terminal-rail-scoping). The rail is
 * therefore forced OFF via withRailMode rather than silently inherited from
 * the runner's default profile.
 *
 * This is the COMPLEMENT of journey 17, and the two are deliberately disjoint:
 * 17 asserts a NEW pid (proving `spawnPty`'s create-time CWD, excluding this
 * `cd` path), while this journey asserts the SAME pid MOVED (proving the sync
 * path, excluding a respawn). Neither can pass through the other's mechanism, so
 * a regression in either is attributable to one file.
 *
 * WHY A→B AND NOT "TERMINAL FIRST, WORKSPACE SECOND": the terminal cannot be
 * opened without a workspace at all — `terminalGate.canOpenTerminal()` requires
 * workspace mode (or an active tab with a saved file) and otherwise refuses the
 * toggle with a toast. So the only way to observe a root TRANSITION under a live
 * shell is to open workspace A, start the shell, then switch to workspace B.
 *
 * Safety:
 *   - SKIPS when a workspace is already open: driving the transition would mean
 *     closing the user's workspace, which is destructive.
 *   - Creates and closes only its OWN session; pre-existing sessions untouched.
 *   - Both temp workspaces are closed and removed in teardown; panel visibility
 *     is restored.
 */

import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersistedWorkspaceRoot, poll } from "../lib/vmark.mjs";
import { openWorkspaceViaMcp, closeWorkspace } from "../lib/workspace.mjs";
import { withRailMode } from "../lib/rail.mjs";
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

async function makeWorkspace() {
  const dir = await mkdtemp(join(homedir(), ".vmark-e2e-ws-"));
  await writeFile(join(dir, "readme.md"), "# e2e workspace\n", "utf8");
  return dir;
}

export default {
  name: "terminal-workspace-cd-sync",
  // NOT coverageRequired: dev-docs/e2e-tier0-matrix.md marks I13 explicitly as
  // "✅ automated · coverageRequired" but I15 as plain "✅ automated (skips only
  // if a workspace is already open)" — a deliberate distinction, because this
  // journey's skips (a pre-existing user workspace, a full terminal-session
  // cap) are safety-required rather than coverage loss.

  async run(client, ctx) {
    const existingRoot = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (existingRoot) {
      return {
        skip:
          `workspace already open (${existingRoot}) — this journey must drive the ` +
          `A→B root transition itself, and closing the user's workspace would be destructive`,
      };
    }

    // Rail OFF, explicitly (WI-TS5.2): I15 is the window-scoped cd-follow.
    return withRailMode(client, false, async () => {
    const terminalWasOpen = await isTerminalOpen(client);
    let dirA = null;
    let dirB = null;
    let createdSession = false;

    try {
      // A. Workspace A, then a shell inside it (the terminal gate requires a
      //    workspace before it will open at all).
      dirA = await makeWorkspace();
      await openWorkspaceViaMcp(client, dirA, { windowLabel: ctx.windowLabel });
      await openTerminal(client, ctx.windowLabel);
      if (!(await canCreateSession(client))) {
        const s = await getTerminalSessions(client);
        return { skip: `terminal session cap reached (${s.total} open) — cannot create one to assert on` };
      }

      const pidsBefore = new Set((await getAppShellCwds()).map((s) => s.pid));
      await createTerminalSession(client);
      createdSession = true;

      const spawned = await poll(
        () => getAppShellCwds(),
        (list) => list.some((s) => !pidsBefore.has(s.pid) && s.cwd === dirA),
        `this journey's shell to spawn in workspace A (${dirA})`,
        { timeoutMs: 15000, intervalMs: 500 }
      );
      const shell = spawned.find((s) => !pidsBefore.has(s.pid) && s.cwd === dirA);
      ctx.log(`shell ${shell.comm} (pid ${shell.pid}) running in workspace A`);

      // B. Switch the workspace out from under the live shell.
      dirB = await makeWorkspace();
      await openWorkspaceViaMcp(client, dirB, { windowLabel: ctx.windowLabel });
      ctx.log(`workspace switched to B while the shell was running: ${dirB}`);

      // The SAME pid must follow. Requiring the identical pid is what makes this
      // the cd-sync path rather than a respawn.
      await poll(
        () => getAppShellCwds(),
        (list) => list.some((s) => s.pid === shell.pid && s.cwd === dirB),
        `live shell (pid ${shell.pid}) to cd from A into B (${dirB})`,
        { timeoutMs: 15000, intervalMs: 500 }
      );
      ctx.log(`live shell (pid ${shell.pid}) followed the workspace switch — cd-sync intact`);
    } finally {
      if (createdSession) await closeActiveTerminalSession(client).catch(() => {});
      if (!terminalWasOpen) await closeTerminal(client, ctx.windowLabel).catch(() => {});
      if (dirA || dirB) await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
      for (const d of [dirA, dirB]) {
        if (d) await rm(d, { recursive: true, force: true }).catch(() => {});
      }
    }
    });
  },
};
