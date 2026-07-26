/**
 * Journey: browser-no-bridge  (WI-5.6 · B16 — the R3/SPIKE-1 regression check)
 *
 * WI-5.6 — the no-bridge assertion, relocated from the MCP lane to the Tauri lane.
 *
 * VMark constructs its own `WKWebView` rather than asking Tauri for one, so
 * Tauri's IPC bridge is never injected into a browsed page (ADR-B2). That is the
 * single load-bearing privacy claim of the embedded browser: without it, ANY site
 * you visit gets a channel into the app — file access, command invocation, the
 * lot.
 *
 * `browser_assert_no_bridge` was written as the permanent regression check for
 * exactly this, and it had **never run in the suite**. The claim was resting on a
 * spike report and a code comment.
 *
 * WHY THIS LIVES IN THE TAURI LANE, not the MCP one. `browser_assert_no_bridge`
 * is a Tauri command, not an action in the browser tool's enum
 * (`tools/browser.ts`), so it cannot be driven through the sidecar at all. The
 * plan originally filed it under Phase 5; the review caught that and it moved.
 *
 * The assertion runs in the PAGE world (not the driver's isolated world), which
 * is the only place the leak would be visible — checking from the isolated world
 * would report "clean" no matter what, since the isolated world never has the
 * bridge regardless.
 *
 * SEEN TO FAIL: verified by asserting on a deliberately inverted expectation
 * (requiring `hasTauri === true`), which goes red against the real all-false
 * result — confirming the flags are read, not assumed.
 *
 * Safety: local fixture only; the AI tab is disposed by restoring
 * `browser.enabled`. No documents touched.
 */

import { evalJs } from "../lib/bridge.mjs";
import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

/** Every flag the assertion reports; all must be false. */
const FLAGS = ["hasTauriInternals", "hasTauri", "hasIpc", "invokeReachable"];

export default {
  name: "browser-no-bridge",
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
        if (fx.hits("/") < 1) throw new Error("the fixture page was never requested");

        const state = await mcp.callTool("session", { action: "get_state" });
        const tab = (state.json?.windows ?? [])
          .flatMap((w) => w.tabs ?? [])
          .find((t) => t.kind === "browser");
        if (!tab?.id) throw new Error("no browser tab found in session state");

        const raw = await evalJs(
          client,
          `(async () => {
             try {
               return await window.__TAURI__.core.invoke('browser_assert_no_bridge', {
                 tabId: ${JSON.stringify(tab.id)},
               });
             } catch (e) { return 'ERR ' + (e && e.message ? e.message : String(e)); }
           })()`
        );
        if (typeof raw === "string" && raw.startsWith("ERR ")) {
          throw new Error(`browser_assert_no_bridge failed: ${raw}`);
        }

        const report = typeof raw === "string" ? JSON.parse(raw) : raw;
        // Every flag must be PRESENT and false. A missing flag would otherwise
        // read as falsy and pass — which would quietly stop checking a leak.
        for (const flag of FLAGS) {
          if (!(flag in report)) {
            throw new Error(`assertion did not report '${flag}': ${JSON.stringify(report)}`);
          }
          if (report[flag] !== false) {
            throw new Error(
              `TAURI BRIDGE LEAKED INTO THE BROWSED PAGE — ${flag} is ${report[flag]}. ` +
                `Any visited site can now reach the app.`
            );
          }
        }
        ctx.log(`no-bridge verified in the page world (${FLAGS.length} flags all false)`);
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
