/**
 * Journey: terminal-rail-scoping  (Tier-0 · workspace-rail/terminal integration)
 *
 * Invariant I16 (WI-TS5.2) — with the workspace rail ON, terminal sessions are
 * scoped to their owning workspace instance: a rail switch SWAPS the visible
 * session set and leaves every hidden shell exactly where it was — alive, same
 * pid, same cwd, nothing typed into it. This is the regression journey for the
 * 2026-08-31 bug class: the old window-global set "followed" a switch by
 * typing `cd` into every live shell, which deferred forever under a busy
 * foreground command (any AI tool, vim, a dev server) and, on non-integrated
 * shells, typed INTO the running program.
 *
 * COMPLEMENT of journeys 17/18: those pin the rail-OFF (window-scoped)
 * behaviors — spawn cwd and cd-follow. This journey pins the rail-ON
 * contract: pid identity + cwd stability across switches, per-scope tab
 * sets, and per-scope auto-create.
 *
 * Safety:
 *   - SKIPS when a workspace is already open (driving rail switches would
 *     disturb it) and when any terminal session exists (window-scoped
 *     leftovers stay visible in every scope and would blur the swap
 *     assertions).
 *   - Rail mode is restored by withRailMode's `finally`; panel visibility is
 *     restored; its own sessions are closed; both temp dirs removed.
 *
 * FOREGROUND DEPENDENCY (shared with journeys 17/18): the lazy shell spawn
 * runs in a requestAnimationFrame, and WebKit SUSPENDS rAF while the window
 * is backgrounded — a spawn wait against a hidden window times out with the
 * session tab visible and no PTY. CI keeps the app window frontmost; run
 * locally with the debug app's window in the foreground. (Verified live
 * 2026-08-31: the parked spawn fired the instant the window was focused.)
 */

import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersistedWorkspaceRoot, poll } from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";
import { openWorkspaceViaMcp, closeWorkspace } from "../lib/workspace.mjs";
import { withRailMode, getRailInstances, clickRailInstance } from "../lib/rail.mjs";
import {
  isTerminalOpen,
  openTerminal,
  closeTerminal,
  getAppShellCwds,
  getTerminalSessions,
  closeActiveTerminalSession,
} from "../lib/terminal.mjs";

async function makeWorkspace() {
  const dir = await mkdtemp(join(homedir(), ".vmark-e2e-rail-"));
  await writeFile(join(dir, "readme.md"), "# e2e rail workspace\n", "utf8");
  return dir;
}

/** Visible terminal tabs in the DOM — the scoped tab bar's rendering. */
const visibleTabCount = (client) =>
  evalJs(client, `document.querySelectorAll(".terminal-tab").length`);

export default {
  name: "terminal-rail-scoping",

  async run(client, ctx) {
    const existingRoot = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (existingRoot) {
      return {
        skip: `workspace already open (${existingRoot}) — this journey drives rail switches itself`,
      };
    }
    const preSessions = await getTerminalSessions(client);
    if (preSessions.total > 0) {
      return {
        skip: `${preSessions.total} terminal session(s) already open — window-scoped leftovers stay visible in every scope`,
      };
    }

    return withRailMode(client, true, async () => {
      const terminalWasOpen = await isTerminalOpen(client);
      let dirA = null;
      let dirB = null;
      let idA = null;
      let idB = null;
      try {
        // Workspace A joins the rail; its empty scope auto-creates a session.
        dirA = await makeWorkspace();
        await openWorkspaceViaMcp(client, dirA, { windowLabel: ctx.windowLabel });
        const railAfterA = await poll(
          () => getRailInstances(client),
          (list) => list.length >= 1,
          "workspace A to appear on the rail",
          { timeoutMs: 10000, intervalMs: 250 },
        );
        idA = railAfterA[railAfterA.length - 1].instanceId;

        const pidsBefore = new Set((await getAppShellCwds()).map((s) => s.pid));
        await openTerminal(client, ctx.windowLabel);
        const spawnedA = await poll(
          () => getAppShellCwds(),
          (list) => list.some((s) => !pidsBefore.has(s.pid) && s.cwd === dirA),
          `A's session to spawn in workspace A (${dirA})`,
          { timeoutMs: 15000, intervalMs: 500 },
        );
        const shellA = spawnedA.find((s) => !pidsBefore.has(s.pid) && s.cwd === dirA);
        ctx.log(`A's shell ${shellA.comm} (pid ${shellA.pid}) in ${dirA}`);

        // Workspace B joins the rail; switch to it.
        dirB = await makeWorkspace();
        await openWorkspaceViaMcp(client, dirB, { windowLabel: ctx.windowLabel });
        const railAfterB = await poll(
          () => getRailInstances(client),
          (list) => list.length >= 2,
          "workspace B to appear on the rail",
          { timeoutMs: 10000, intervalMs: 250 },
        );
        idB = railAfterB.map((i) => i.instanceId).find((id) => id !== idA);
        await clickRailInstance(client, idB);

        // B's empty scope auto-creates its own session, IN B.
        const spawnedB = await poll(
          () => getAppShellCwds(),
          (list) => list.some((s) => s.cwd === dirB),
          `B's session to spawn in workspace B (${dirB})`,
          { timeoutMs: 15000, intervalMs: 500 },
        );
        const shellB = spawnedB.find((s) => s.cwd === dirB);
        ctx.log(`B's shell ${shellB.comm} (pid ${shellB.pid}) in ${dirB}`);

        // THE invariant: A's shell is ALIVE, in the SAME cwd — never cd'd.
        const listInB = await getAppShellCwds();
        const shellAInB = listInB.find((s) => s.pid === shellA.pid);
        if (!shellAInB) {
          throw new Error(`A's shell (pid ${shellA.pid}) died on the rail switch`);
        }
        if (shellAInB.cwd !== dirA) {
          throw new Error(
            `A's shell was cd'd by the switch: ${shellAInB.cwd} (expected ${dirA})`,
          );
        }
        // …and the DOM tab set swapped to B's single session.
        await poll(
          () => visibleTabCount(client),
          (n) => n === 1,
          "the tab bar to show only B's session",
          { timeoutMs: 10000, intervalMs: 250 },
        );
        ctx.log(`tab set swapped; A's pid ${shellA.pid} untouched in ${dirA}`);

        // Switch back: the SAME pid revealed, same cwd — no respawn, no cd.
        await clickRailInstance(client, idA);
        await poll(
          () => visibleTabCount(client),
          (n) => n === 1,
          "the tab bar to show only A's session again",
          { timeoutMs: 10000, intervalMs: 250 },
        );
        const listBack = await getAppShellCwds();
        const shellABack = listBack.find((s) => s.pid === shellA.pid);
        if (!shellABack || shellABack.cwd !== dirA) {
          throw new Error(
            `switch-back did not reveal the SAME shell in the SAME cwd: ${JSON.stringify(shellABack ?? null)}`,
          );
        }
        ctx.log(`switch-back revealed pid ${shellA.pid} unchanged — scoped sessions intact`);
      } finally {
        // Close our OWN sessions in whichever scopes still exist.
        await closeActiveTerminalSession(client).catch(() => {});
        for (const id of [idB, idA]) {
          if (!id) continue;
          await clickRailInstance(client, id).catch(() => {});
          await closeActiveTerminalSession(client).catch(() => {});
        }
        if (!terminalWasOpen) await closeTerminal(client, ctx.windowLabel).catch(() => {});
        if (dirA || dirB) {
          // Each close promotes the next railed workspace; two closes empty the rail.
          await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
          await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
        }
        for (const d of [dirA, dirB]) {
          if (d) await rm(d, { recursive: true, force: true }).catch(() => {});
        }
      }
    });
  },
};
