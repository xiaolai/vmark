/**
 * Journey: browser-takeover  (WI-NB5.2 · D7v2 — touching the browser is the stop button)
 *
 * The plan gated the workflow phase on an acceptance test that a human takeover
 * reaches the frontend and stops a run. That test was never written (audit
 * 2026-09-03, T-holes), and the run's approval wait could not be interrupted at all
 * (W-01): a step waiting on a prompt kept polling after the human took over, and
 * a late Allow still clicked. This journey pins the whole chain from the outside:
 *
 *   1. `workflow_run` starts a run whose first step needs approval → the run
 *      reports `pendingApproval`, the prompt is on screen, the chrome shows the
 *      "AI is controlling" indicator.
 *   2. The human takes over through the chrome (the indicator button — the same
 *      `reclaimForHuman` the native page-input signal fires).
 *   3. The run pauses (`lease-lost`), the prompt is WITHDRAWN, and the fixture's
 *      click counter stays at zero: nothing acted after the takeover.
 *   4. A new run on the tab is allowed again — the human hold is not permanent.
 *
 * WHY THE FIXTURE COUNTER. `workflow_status` saying `paused` is the run's own
 * account of itself. The server-side hit counter is the page's account, and a
 * click that slipped through after the takeover would show there and nowhere else.
 *
 * WHY THE CHROME BUTTON RATHER THAN A NATIVE CLICK. A real pointer event into the
 * sibling WKWebView needs OS-level input (Accessibility permission for System
 * Events), which the harness cannot assume. The chrome button and the native
 * `browser://user-input` signal both call `reclaimForHuman`; the native emitter is
 * pinned by Rust tests, the wiring by `browserLeaseWiring.test.ts`, and this journey
 * covers everything downstream of the reclaim in the running app.
 *
 * Safety: local fixture only; the AI tab is disposed by `withBrowserEnabled`.
 */

import { poll } from "../lib/vmark.mjs";
import { evalJs } from "../lib/bridge.mjs";
import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";
import { readApprovalDialog, waitForApprovalDialog } from "../lib/browserApproval.mjs";

const SOURCE = ["---", "site: fixture", "---", '1. action: click "Press Me" (button)'].join("\n");

async function leaseIndicatorVisible(client) {
  return evalJs(client, `document.querySelector('.browser-ai-lease') !== null`);
}

export default {
  name: "browser-takeover",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const fx = await startFixtureServer();
    const mcp = await startVmarkMcp();
    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        const open = await mcp.callTool("browser", { action: "open", url: fx.url("/") });
        if (open.isError) throw new Error(`open failed: ${open.text.slice(0, 250)}`);
        const tabId = open.json?.tabId;
        if (!tabId) throw new Error("open returned no tabId");

        // 1. A run whose first write step needs the user's approval.
        const started = await mcp.callTool("browser", { action: "workflow_run", tabId, source: SOURCE });
        if (started.isError) throw new Error(`workflow_run failed: ${started.text.slice(0, 250)}`);
        const runId = started.json?.runId;
        if (!runId) throw new Error("workflow_run returned no runId");
        await waitForApprovalDialog(client);
        await poll(
          async () => (await mcp.callTool("browser_read", { action: "workflow_status", runId })).json,
          (s) => s?.status === "running" && s?.pendingApproval?.operation === "click",
          "run reports pendingApproval for the click",
          { timeoutMs: 8000 },
        );
        if (!(await leaseIndicatorVisible(client))) {
          throw new Error("the 'AI is controlling' indicator is not shown while a run holds the tab");
        }
        if (fx.hits("/hit/clicked") !== 0) throw new Error("fixture counter non-zero before takeover");
        ctx.log("run is waiting on approval; indicator shown");

        // 2. The human takes over through the chrome.
        const clicked = await evalJs(
          client,
          `(() => { const b = document.querySelector('.browser-ai-lease'); if (!b) return false; b.click(); return true; })()`,
        );
        if (clicked !== true) throw new Error("could not click the takeover indicator");

        // 3. The run pauses, the prompt is withdrawn, nothing acted.
        const status = await poll(
          async () => (await mcp.callTool("browser_read", { action: "workflow_status", runId })).json,
          (s) => s?.status !== "running",
          "run leaves the running state after takeover",
          { timeoutMs: 8000 },
        );
        if (status.status !== "paused" || status.reasonCode !== "lease-lost") {
          throw new Error(`expected paused/lease-lost after takeover, got ${JSON.stringify(status).slice(0, 300)}`);
        }
        await poll(() => readApprovalDialog(client), (d) => d === null, "prompt withdrawn after takeover", {
          timeoutMs: 5000,
        });
        if (fx.hits("/hit/clicked") !== 0) {
          throw new Error("the run clicked after the human took over");
        }
        if (await leaseIndicatorVisible(client)) {
          throw new Error("the indicator is still shown after the takeover");
        }
        ctx.log("takeover paused the run and withdrew its prompt");

        // 4. The tab is usable by a new run: the human hold is not permanent.
        const again = await mcp.callTool("browser", { action: "workflow_run", tabId, source: SOURCE });
        if (again.isError) throw new Error(`a new run after takeover was refused: ${again.text.slice(0, 250)}`);
        const cancel = await mcp.callTool("browser", { action: "workflow_cancel", runId: again.json?.runId });
        if (cancel.isError) throw new Error(`workflow_cancel failed: ${cancel.text.slice(0, 200)}`);
        await poll(() => readApprovalDialog(client), (d) => d === null, "second run's prompt withdrawn on cancel", {
          timeoutMs: 5000,
        });
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
