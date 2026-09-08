/**
 * Journey: knowledge-base-runtime-state
 *
 * WI-FL1.1: opening View → Knowledge Base must TELL the user what a start
 * would find. While the server is stopped the panel probes
 * `content_server_runtime` (node on the login-shell PATH, and the content
 * server's cli.js from `VMARK_CONTENT_SERVER_CLI`, the bundled resource, or a
 * provisioned base-kb) and renders one of: the Start button (both present), or
 * an alert naming each missing half and what provides it, with "Check again"
 * in place of Start. v0.9.65 shipped the menu item with a Start that ended in
 * `not-found` on every packaged install, and nothing observed it.
 *
 * This is a LIVE assertion, not a mock: the probe runs `which node` through a
 * real login shell and resolves the CLI against the real app-data dir, which is
 * why the jsdom test (KnowledgeBasePanel.runtime.test.tsx) cannot stand in for
 * it. The journey asserts whichever state the machine is actually in and says
 * which one ran:
 *
 *   - missing → the alert lists the content-server CLI as missing with the
 *     DEVELOPMENT wording (it names `VMARK_CONTENT_SERVER_CLI`; the packaged
 *     wording does not), Start is absent, "Check again" is offered. With the
 *     env var unset and no provisioned base-kb this is what `pnpm tauri:dev`
 *     shows — and the literal env-var name is what makes the check
 *     locale-independent: every bundle carries it verbatim.
 *   - ready → exactly one Start button in the stopped body, no alert, no note.
 *   - a probe that FAILED (the command rejected) is a defect and fails the
 *     journey with the panel's own message; it is never a skip.
 *
 * The runtime body renders only while the server is `stopped`. Any other
 * status is valid user state — someone started the server in this session —
 * and is reported as a SKIP naming the status, the same idiom the autosave
 * journey uses for "autosave is off". Nothing here starts, stops or restarts a
 * server; the panel is closed again in teardown if this journey opened it.
 *
 * Driving: `menu:knowledge-base` → view.toggleKnowledgeBase → contentServerStore
 * togglePanel — the native View-menu path. Observation: the panel DOM
 * (KnowledgeBasePanel.tsx / KnowledgeBaseRuntimeState.tsx).
 */

import { evalJs } from "../lib/bridge.mjs";
import { emitMenu, poll } from "../lib/vmark.mjs";

/** The literal every locale's `contentServer.runtime.cliMissingDev` carries. */
const CLI_ENV_VAR = "VMARK_CONTENT_SERVER_CLI";

/** `which node` runs through a real login shell; a slow rc file is not a failure. */
const PROBE_TIMEOUT_MS = 20000;

const DOCK_OPEN = `!!document.querySelector('[data-testid="kb-dock"]')`;

/**
 * One snapshot of the panel's runtime body. `startButtons` counts DIRECT
 * children of the stopped body: the ready state renders the Start button
 * there, the failed state renders a note AND Start, the missing state renders
 * the alert (whose only button is "Check again"), and the checking state only
 * a note — so (missingItems, startButtons, note) identifies every phase.
 */
const PANEL_SNAPSHOT = `(() => {
  const panel = document.querySelector('.kb-panel');
  if (!panel) return null;
  const empty = panel.querySelector('.kb-panel__empty');
  const missing = panel.querySelector('[data-testid="kb-runtime-missing"]');
  const note = panel.querySelector('.kb-panel__runtime-note');
  return {
    status: panel.querySelector('.kb-panel__status')?.getAttribute('data-status') ?? null,
    stoppedBody: !!empty,
    note: note ? (note.textContent ?? '') : null,
    missingItems: missing ? [...missing.querySelectorAll('li')].map((li) => li.textContent ?? '') : null,
    recheckButtons: missing ? missing.querySelectorAll('button').length : 0,
    startButtons: empty ? [...empty.children].filter((el) => el.tagName === 'BUTTON').length : 0,
  };
})()`;

const snapshot = (client) => evalJs(client, PANEL_SNAPSHOT);

export default {
  name: "knowledge-base-runtime-state",

  async run(client, ctx) {
    const initiallyOpen = await evalJs(client, DOCK_OPEN);
    ctx.log(`knowledge base panel initially ${initiallyOpen ? "open" : "closed"}`);

    try {
      if (!initiallyOpen) {
        await emitMenu(client, "knowledge-base", ctx.windowLabel);
        await poll(() => evalJs(client, DOCK_OPEN), (v) => v === true, "menu:knowledge-base to open the panel");
      }
      const first = await poll(() => snapshot(client), (s) => s !== null && s.status !== null, "the panel to render its status");

      if (first.status !== "stopped") {
        return {
          skip: `content server is "${first.status}" — the runtime probe renders only while stopped; stop the server and rerun`,
        };
      }

      // Wait for the probe to resolve: the alert (missing) or a Start button
      // (ready / failed). The checking phase has neither.
      const state = await poll(
        () => snapshot(client),
        (s) => s !== null && (s.missingItems !== null || s.startButtons > 0),
        "the runtime probe to resolve (alert or Start button)",
        { timeoutMs: PROBE_TIMEOUT_MS }
      );
      if (state.status !== "stopped") {
        throw new Error(`server status changed under the probe: ${state.status} (nothing here starts a server)`);
      }

      if (state.missingItems !== null) {
        // ---- missing ----
        const namesCli = state.missingItems.some((text) => text.includes(CLI_ENV_VAR));
        if (!namesCli) {
          throw new Error(
            `runtime alert does not name the content-server CLI with the development wording ` +
              `(expected an item mentioning ${CLI_ENV_VAR}); items: ${JSON.stringify(state.missingItems)}`
          );
        }
        if (state.startButtons !== 0) {
          throw new Error(`missing state must not offer Start (found ${state.startButtons} in the stopped body)`);
        }
        if (state.recheckButtons < 1) throw new Error("missing state offers no \"Check again\" button");
        ctx.log(`branch=missing — ${state.missingItems.length} item(s): ${JSON.stringify(state.missingItems)}`);
      } else if (state.note === null) {
        // ---- ready ----
        if (state.startButtons !== 1) {
          throw new Error(`ready state must render exactly one Start button, found ${state.startButtons}`);
        }
        ctx.log("branch=ready — node and the content-server CLI both resolved; Start offered");
      } else {
        // ---- failed: the probe command itself rejected ----
        throw new Error(`content_server_runtime probe FAILED in the app: ${state.note.trim()}`);
      }
    } finally {
      // Restore what was toggled: close the panel only if this journey opened it.
      if (!initiallyOpen) {
        const open = await evalJs(client, DOCK_OPEN);
        if (open) {
          await emitMenu(client, "knowledge-base", ctx.windowLabel);
          await poll(() => evalJs(client, DOCK_OPEN), (v) => v === false, "knowledge base panel to close again");
        }
      }
    }
    ctx.log("knowledge base panel visibility restored to initial state");
  },
};
