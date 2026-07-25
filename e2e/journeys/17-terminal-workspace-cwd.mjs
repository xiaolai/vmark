/**
 * Journey: terminal-workspace-cwd  (Tier-0 · workspace/terminal integration)
 *
 * The terminal's spawn contract against a REAL workspace — the one part of the
 * terminal that unit tests structurally cannot cover, because it needs a real
 * workspace root, a real PTY, and a real shell process:
 *
 *   - `open_workspace` completes its full shipping approval flow (fail-now →
 *     approve in the dialog → AI-retry consumes the one-shot grant);
 *   - toggling the terminal SPAWNS A NEW shell whose CWD is the workspace root,
 *     which is `spawnPty.ts`'s documented first priority ("workspace root >
 *     active file's parent > shell default").
 *
 * A regression here is silent and expensive: the shell quietly lands in `$HOME`
 * instead of the project, so every relative path a user types resolves against
 * the wrong tree.
 *
 * WHY THE NEW-PID ASSERTION: VMark has a SECOND, independent path to the same
 * observable — `terminalSessionStoreSync.ts` writes a `cd` into ALREADY-RUNNING
 * sessions when the workspace root changes. A surviving shell from an earlier
 * session therefore reaches the right cwd even if `spawnPty` is completely
 * broken. (This journey was seen passing that way during development.) So the
 * shell PIDs are snapshotted BEFORE the terminal opens and the assertion demands
 * a pid that was not there before — the cd-sync path cannot satisfy it. For the
 * same reason the journey skips when any shell is already alive: a fresh spawn
 * cannot be forced without killing a session that may be running the user's work.
 *
 * Assertion is OS-level (child-process cwd) because the WebGL renderer keeps
 * terminal output out of the DOM — see e2e/lib/terminal.mjs for the full
 * rationale and for why `VMARK_WORKSPACE` stays manual-only (macOS SIP).
 *
 * Safety:
 *   - SKIPS if the terminal is already open, or if any shell session is already
 *     alive — both would mean disturbing (or silently relying on) a session that
 *     may be running the user's own work.
 *   - If a workspace is already open, that one is used READ-ONLY (no open, no
 *     close). A temp workspace is created only when none is open, and is closed
 *     and removed in teardown.
 *   - Touches no tabs and no documents.
 */

import { rm, mkdtemp, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPersistedWorkspaceRoot, poll } from "../lib/vmark.mjs";
import { openWorkspaceViaMcp, closeWorkspace } from "../lib/workspace.mjs";
import {
  isTerminalOpen,
  openTerminal,
  closeTerminal,
  getAppShellCwds,
  getTerminalSessionCount,
} from "../lib/terminal.mjs";

export default {
  name: "terminal-workspace-cwd",

  async run(client, ctx) {
    if (await isTerminalOpen(client)) {
      return { skip: "terminal already open — refusing to disturb a live shell session" };
    }
    // A hidden panel still holds its session, so "closed" does not imply "no
    // session". Any EXISTING session blocks the fresh spawn this journey asserts:
    // a live one would merely be cd-synced to the new root (masking a broken
    // spawn), and a dead one respawns only on the next keypress while still
    // suppressing auto-create. Either way there is nothing honest to observe, and
    // neither can be cleared without destroying a session that may hold the
    // user's work. In practice this means the journey runs on a fresh app launch
    // and skips on later runs in the same session.
    const sessions = await getTerminalSessionCount(client);
    const shellsBefore = await getAppShellCwds();
    if (sessions > 0 || shellsBefore.length > 0) {
      return {
        skip:
          `${sessions} terminal session(s) / ${shellsBefore.length} shell(s) already exist — ` +
          `a fresh spawn cannot be forced without destroying a session that may hold the user's work`,
      };
    }
    const pidsBefore = new Set(shellsBefore.map((s) => s.pid));

    const existingRoot = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    let tempDir = null;
    let root = existingRoot;

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

      await openTerminal(client, ctx.windowLabel);
      ctx.log("terminal panel mounted");

      // A NEWLY spawned shell must land in the workspace root. Requiring an
      // unseen pid is what makes this the spawn path and not the cd-sync path.
      const shells = await poll(
        () => getAppShellCwds(),
        (list) => list.some((s) => !pidsBefore.has(s.pid) && s.cwd === root),
        `a NEWLY spawned terminal shell with cwd === ${root}`,
        { timeoutMs: 15000, intervalMs: 500 }
      );
      const match = shells.find((s) => !pidsBefore.has(s.pid) && s.cwd === root);
      ctx.log(`newly spawned shell ${match.comm} (pid ${match.pid}) has cwd ${match.cwd}`);
    } finally {
      await closeTerminal(client, ctx.windowLabel).catch(() => {});
      if (tempDir) {
        await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  },
};
