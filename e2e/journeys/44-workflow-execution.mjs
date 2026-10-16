/**
 * Journey: workflow-execution
 *
 * Journey 13 opens a workflow YAML and stops at the split pane. This one RUNS
 * one: an engine workflow (website/guide/workflows.md — top-level `steps:`
 * using `action/*`) opened from a workspace, started with the panel's real Run
 * button, executed by the Rust runner, and checked two ways — the step
 * statuses the panel paints, and the file the workflow wrote, read back FROM
 * DISK in this Node process. The jsdom tier
 * (src/test/tier0/workflowRun.test.tsx) pins the frontend half with `invoke`
 * and the runner's events faked; nothing there executes a step.
 *
 * THE WORKFLOW needs no AI provider and no network — `action/*` steps only
 * (src-tauri/src/workflow/actions.rs; `provider` is optional for them,
 * commands.rs `run_workflow`):
 *
 *     read    action/read-file   input.md                       → outputs.text
 *     notify  action/notify      a message
 *     write   action/save-file   out/result.md ← ${{ steps.read.outputs.text }}
 *
 * So the bytes of `out/result.md` are the bytes of `input.md` (CJK, a `${HOME}`
 * that must NOT be expanded — expressions.rs scans the template once — and a
 * trailing newline), carried through the runner's step outputs and written by
 * the sandboxed, atomic writer into a directory the step had to create.
 *
 * WHAT HAS TO BE TRUE FIRST, each arranged through the app's own path and put
 * back in `finally`:
 *   - `advanced.workflowEngine` on: the yaml adapter mounts the Run panel only
 *     then (lib/formats/adapters/yaml.tsx) and Rust refuses `run_workflow`
 *     otherwise (workflow/guards.rs). Set through the `vmark-settings` storage
 *     event (hooks/useSettingsSync.ts), which the engine-policy sync
 *     (services/workflow/workflowEnginePolicySync.ts) forwards to Rust.
 *   - `general.coherenceCaptureOnSave` off: with it on a save-file step stamps
 *     a `vmark:` identity block into what it writes, and the byte-for-byte
 *     oracle would be wrong on correct output. Pinned only if it is on.
 *   - `formats.defaultViewMode` not `source`: that mode unmounts the preview
 *     pane the panel lives in. Pinned to `split` only if it is `source`.
 *   - a workspace: Run is disabled without one (useWorkflowRunControls.ts
 *     `needsWorkspace`) and the runner sandboxes every path to its root. The
 *     fixture directory is opened through the real approval flow
 *     (e2e/lib/workspace.mjs), with the rail forced OFF so the tab bar is one
 *     context for the whole journey, and closed again afterwards.
 *
 * SKIPS when a workspace is already open: this journey must make its own
 * fixture the workspace root, and closing the user's would be destructive.
 * That is user state, not lost coverage, so it is not `coverageRequired`.
 *
 * KNOWN RESIDUE: a save-file run is refused unless its targets are snapshotted
 * first (workflow/prepare.rs), so one snapshot record for this run stays under
 * the dev profile's app data (retention: 50, workflow/snapshots.rs) — there is
 * no command that deletes one. Opening a workspace also shows the sidebar's
 * file view (services/workspaces/openWorkspaceByPath.ts); it is put back to
 * hidden, or to the outline, through the same menu commands a user has — any
 * other prior sidebar view is logged, not restored. The recent-workspace entry
 * is removed through the DEV seam journey 37 uses.
 *
 * WAITS — all `poll()`: the panel mounting (a lazy chunk), Run becoming
 * enabled (the workspace root and the parsed graph) AND the step graph drawn —
 * two separate facts. Run is enabled from the PARSED graph, but the canvas
 * draws its nodes one commit later: WorkflowPreview wraps <ReactFlow> in its
 * own ReactFlowProvider, so React Flow seeds no initial nodes and its
 * StoreUpdater pushes them in a passive effect after the first commit. Gating
 * on Run alone read the graph inside that gap (run 38218593893: "the step
 * graph shows []" with Run already enabled). Then: the run having started
 * (Cancel shown, or a step already painted — a three-step local run can finish
 * between two polls), every step painted `success` with Run offered again, and
 * the file on disk. Run is re-clicked only while NOTHING has started: the
 * engine flag reaches Rust asynchronously, and a start refused as
 * `feature-disabled` registers no run, so retrying it cannot double-run.
 */

import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeAppTempDir } from "../lib/fixtures.mjs";
import { openFixtureInNewTab } from "../lib/disk.mjs";
import { evalJs } from "../lib/bridge.mjs";
import { patchPersistedSettings, readPersistedSettingsSection } from "../lib/settingsPatch.mjs";
import { openWorkspaceViaMcp, closeWorkspace } from "../lib/workspace.mjs";
import { withRailMode, getRailInstances, restoreRail } from "../lib/rail.mjs";
import {
  withTabRestore,
  createScratchTab,
  closeTabById,
  getTabs,
  getPersistedWorkspaceRoot,
  readLocalStorage,
  restoreLocalStorage,
  emitMenu,
  poll,
} from "../lib/vmark.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULTS_PATH = "src/stores/settingsStore/defaults.ts";
const STEPS = ["read", "notify", "write"];
const RUN_TIMEOUT_MS = 30000;

/**
 * The SHIPPED default of a scalar setting, read from the app's own defaults
 * (the rule e2e/lib/rail.mjs `shippedRailModeDefault` states: a restore that
 * hardcodes today's default restores the wrong value after the default moves).
 */
function shippedDefault(key) {
  const source = readFileSync(join(REPO, DEFAULTS_PATH), "utf8");
  const m = new RegExp(`^\\s*${key}:\\s*(true|false|"[^"]*")\\s*,`, "m").exec(source);
  if (!m) throw new Error(`${DEFAULTS_PATH} no longer declares a scalar \`${key}\` default`);
  return JSON.parse(m[1]);
}

/**
 * Set `section.key` for the length of `fn`, then restore it PRESENCE-faithfully
 * (withRailMode's rule): a key that was persisted gets its value back; one that
 * was absent gets the shipped default pushed through the storage event — the
 * reconciler deep-merges, so deleting alone never resets the live store — and
 * is then deleted again.
 */
async function withSetting(client, section, key, value, fn) {
  const before = await readPersistedSettingsSection(client, section);
  const hadKey = Boolean(before && Object.prototype.hasOwnProperty.call(before, key));
  let bodyFailed = false;
  try {
    await patchPersistedSettings(client, section, { [key]: value });
    return await fn();
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    try {
      if (hadKey) {
        await patchPersistedSettings(client, section, { [key]: before[key] });
      } else {
        await patchPersistedSettings(client, section, { [key]: shippedDefault(key) });
        await patchPersistedSettings(client, section, {}, { deleteKeys: [key] });
      }
    } catch (restoreError) {
      if (!bodyFailed) throw restoreError;
      console.error(`workflow-execution: failed to restore ${section}.${key} after a body error:`, restoreError);
    }
  }
}

/** What the engine's run panel shows, read from its own DOM (WorkflowRunPanel.tsx). */
const PANEL_SNIPPET = `(() => {
  const panel = document.querySelector('.workflow-side-panel__content');
  if (!panel) return { mounted: false };
  const run = panel.querySelector('.workflow-side-panel__btn--run');
  const status = {};
  for (const node of panel.querySelectorAll('.react-flow__node[data-id]')) {
    const inner = node.querySelector('.workflow-node');
    const painted = /workflow-node--(running|success|error|skipped)/.exec(inner?.className ?? '');
    status[node.getAttribute('data-id')] = {
      status: painted ? painted[1] : 'pending',
      error: inner?.querySelector('.workflow-node__status-icon--error')?.getAttribute('title') ?? null,
    };
  }
  return {
    mounted: true,
    runOffered: !!run,
    runEnabled: !!run && !run.disabled,
    cancelOffered: !!panel.querySelector('.workflow-side-panel__btn--cancel'),
    statusLine: panel.querySelector('.workflow-side-panel__status')?.textContent ?? null,
    parseError: panel.querySelector('.workflow-side-panel__error-text')?.textContent ?? null,
    restoreOffered: !!panel.querySelector('.workflow-side-panel__toolbar .vm-btn'),
    steps: status,
  };
})()`;

const panelState = (client) => evalJs(client, PANEL_SNIPPET);

/** The sidebar as shown: mounted at all, and which view (Sidebar.tsx, OutlineView). */
const sidebarState = (client) =>
  evalJs(
    client,
    `(() => {
       const sidebar = document.querySelector('.sidebar');
       if (!sidebar) return { visible: false, view: null };
       const view = sidebar.querySelector('.outline-view') ? 'outline' : sidebar.querySelector('.sidebar-header-actions') ? 'files' : 'other';
       return { visible: true, view };
     })()`
  );

/** Undo what opening a workspace did to the sidebar, where a menu command can. */
async function restoreSidebar(client, ctx, before) {
  const now = await sidebarState(client);
  if (now.visible === before.visible && now.view === before.view) return;
  const menu = !before.visible && now.view === "files" ? "file-explorer" : before.view === "outline" ? "outline" : null;
  if (!menu) {
    ctx.log(`note: the sidebar was ${JSON.stringify(before)} and is left as ${JSON.stringify(now)}`);
    return;
  }
  await emitMenu(client, menu, ctx.windowLabel);
  await poll(() => sidebarState(client), (s) => s.visible === before.visible && s.view === before.view, "the sidebar to be as it was found", {
    timeoutMs: 5000,
  }).catch((err) => ctx.log(`warning: ${err?.message ?? err}`));
}

/** Has a run started — live, or already painting results? */
const started = (p) => p.mounted && (p.cancelOffered || Object.values(p.steps).some((s) => s.status !== "pending"));

/** The most recent error toast's text, for a start the app refused. */
const lastToast = (client) =>
  evalJs(client, `[...document.querySelectorAll('[data-sonner-toast][data-type="error"]')].map((el) => el.textContent).pop() ?? null`).catch(() => null);

/** Click Run until a run has started; a refused start registers nothing, so a retry is safe. */
async function startRun(client, ctx) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const clicked = await evalJs(
      client,
      `(() => {
         const run = document.querySelector('.workflow-side-panel__content .workflow-side-panel__btn--run');
         if (!run || run.disabled) return false;
         run.click();
         return true;
       })()`
    );
    if (!clicked && !started(await panelState(client))) throw new Error("the Run button is not available to click");
    try {
      await poll(() => panelState(client), started, "the run to start", { timeoutMs: 4000 });
      return;
    } catch (err) {
      const toast = await lastToast(client);
      ctx.log(`Run attempt ${attempt} did not start a run${toast ? ` (the app said: ${toast})` : ""}`);
      if (attempt === 3) throw new Error(`Run did not start a workflow after 3 clicks${toast ? ` — the app said: ${toast}` : ""}`, { cause: err });
    }
  }
}

export default {
  name: "workflow-execution",

  async run(client, ctx) {
    const existingRoot = await getPersistedWorkspaceRoot(client, ctx.windowLabel);
    if (existingRoot) {
      return {
        skip:
          `workspace already open (${existingRoot}) — this journey must make its own fixture the ` +
          `workspace root, and closing the user's workspace would be destructive`,
      };
    }

    const fixture = await makeAppTempDir();
    const input = `# 输入 ${fixture.stamp}\n\nplain \${HOME} stays as written — 你好\n`;
    const workflow = [
      `name: e2e run ${fixture.stamp}`,
      "steps:",
      "  - id: read",
      "    uses: action/read-file",
      "    with:",
      "      path: input.md",
      "  - id: notify",
      "    uses: action/notify",
      "    with:",
      `      message: journey ${fixture.stamp}`,
      "  - id: write",
      "    uses: action/save-file",
      "    with:",
      "      path: out/result.md",
      "      input: ${{ steps.read.outputs.text }}",
      "",
    ].join("\n");
    const outputPath = join(fixture.dir, "out", "result.md");

    const general = await readPersistedSettingsSection(client, "general");
    const formats = await readPersistedSettingsSection(client, "formats");
    // Only what actually has to change is patched (and therefore restored).
    const pinned = (apply, section, key, value, fn) => (apply ? withSetting(client, section, key, value, fn) : fn());

    const recentsBefore = await readLocalStorage(client, "vmark-recent-files");
    try {
      await writeFile(join(fixture.dir, "input.md"), input, "utf8");
      await writeFile(join(fixture.dir, `flow-${fixture.stamp}.yml`), workflow, "utf8");

      await withRailMode(client, false, () =>
        withSetting(client, "advanced", "workflowEngine", true, () =>
          pinned(general?.coherenceCaptureOnSave === true, "general", "coherenceCaptureOnSave", false, () =>
            pinned(formats?.defaultViewMode === "source", "formats", "defaultViewMode", "split", () =>
              withTabRestore(client, async ({ before, track }) => {
                const railBefore = await getRailInstances(client);
                const sidebarBefore = await sidebarState(client);
                let root = null;
                let fileTabId = null;
                let bodyError = null;
                try {
                  const guard = await createScratchTab(client);
                  track(guard.id);
                  root = await openWorkspaceViaMcp(client, fixture.dir, { windowLabel: ctx.windowLabel });
                  ctx.log(`fixture opened as the workspace: ${root}`);

                  const fileTab = await openFixtureInNewTab(client, { before, track, guardId: guard.id, filePath: join(root, `flow-${fixture.stamp}.yml`) });
                  fileTabId = fileTab.id;

                  const ready = await poll(
                    () => panelState(client),
                    (p) => p.mounted && (p.parseError !== null || (p.runEnabled && Object.keys(p.steps).length > 0)),
                    "the engine's run panel to mount with Run enabled and its step graph drawn",
                    { timeoutMs: 15000 }
                  );
                  if (ready.parseError !== null) throw new Error(`the panel refused the fixture workflow: ${ready.parseError}`);
                  const drawn = Object.keys(ready.steps).sort();
                  if (JSON.stringify(drawn) !== JSON.stringify([...STEPS].sort())) {
                    throw new Error(`the step graph shows ${JSON.stringify(drawn)}, expected ${JSON.stringify(STEPS)}`);
                  }
                  if (Object.values(ready.steps).some((s) => s.status !== "pending")) {
                    throw new Error(`a step is painted before anything ran: ${JSON.stringify(ready.steps)}`);
                  }

                  await startRun(client, ctx);
                  const done = await poll(
                    () => panelState(client),
                    (p) => p.mounted && p.runOffered && !p.cancelOffered && STEPS.every((id) => ["success", "error", "skipped"].includes(p.steps[id]?.status)),
                    "the run to finish with every step painted",
                    { timeoutMs: RUN_TIMEOUT_MS, intervalMs: 250 }
                  );
                  const failed = STEPS.filter((id) => done.steps[id].status !== "success");
                  if (failed.length > 0) {
                    throw new Error(`the workflow did not complete: ${failed.map((id) => `${id}=${done.steps[id].status}${done.steps[id].error ? ` (${done.steps[id].error})` : ""}`).join(", ")}`);
                  }
                  if (done.statusLine === null) throw new Error("the run ended but the panel shows no outcome line");
                  ctx.log(`panel: read, notify, write all success — "${done.statusLine}"${done.restoreOffered ? ", Restore Files offered" : ""}`);

                  // Ground truth: the file the workflow wrote, read back in THIS process.
                  const written = await poll(
                    () => readFile(outputPath, "utf8").catch((err) => (err?.code === "ENOENT" ? null : Promise.reject(err))),
                    (text) => text !== null,
                    `the workflow's output file ${outputPath}`,
                    { timeoutMs: 5000 }
                  );
                  if (written !== input) {
                    throw new Error(`out/result.md is not input.md byte for byte.\n  expected: ${JSON.stringify(input)}\n  on disk:  ${JSON.stringify(written)}`);
                  }
                  if ((await readFile(join(fixture.dir, "input.md"), "utf8")) !== input) throw new Error("the run changed input.md, which it only reads");
                  const tab = (await getTabs(client)).find((t) => t.id === fileTabId);
                  if (tab?.dirty) throw new Error("running the workflow marked its document dirty");
                  ctx.log(`out/result.md on disk is input.md byte for byte (${Buffer.byteLength(written)} bytes)`);
                } catch (err) {
                  bodyError = err;
                  throw err;
                } finally {
                  // The workflow tab first (clean — nothing edited it), then the workspace,
                  // then the rail's identity check. No workspace was open when this journey
                  // started (it skips otherwise), so ANY root open now is this journey's —
                  // including one that landed after `openWorkspaceViaMcp` gave up waiting.
                  if (fileTabId) await closeTabById(client, fileTabId, { force: true }).catch(() => {});
                  const opened = root ?? (await getPersistedWorkspaceRoot(client, ctx.windowLabel).catch(() => null));
                  if (opened) {
                    await closeWorkspace(client, { windowLabel: ctx.windowLabel }).catch(() => {});
                    await evalJs(
                      client,
                      `(() => { const f = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.forgetRecentWorkspace;
                         if (typeof f === "function") f(${JSON.stringify(opened)}); return "OK"; })()`
                    ).catch(() => {});
                    await restoreSidebar(client, ctx, sidebarBefore).catch((err) => ctx.log(`warning: ${err?.message ?? err}`));
                  }
                  try {
                    await restoreRail(client, railBefore);
                  } catch (restoreErr) {
                    if (!bodyError) throw restoreErr;
                    ctx.log(`warning: rail restore failed after a body error: ${restoreErr?.message ?? restoreErr}`);
                  }
                }
              })
            )
          )
        )
      );
    } finally {
      await restoreLocalStorage(client, "vmark-recent-files", recentsBefore);
      await fixture.cleanup();
    }
  },
};
