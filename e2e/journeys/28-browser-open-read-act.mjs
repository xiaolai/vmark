/**
 * Journey: browser-open-read-act  (WI-5.2 · B2/B3/B7 — the core automation loop)
 *
 * Covers, in one flow, the three things the AI browser is FOR:
 *   B2  `open` → `read` returns an ARIA snapshot naming the page's real elements
 *   B7  an ungranted `act` is refused pending approval, and approving it lets the
 *       retry through (ADR-BR2: sequential, not a held-open request)
 *   B3  the click ACTUALLY REACHES THE PAGE
 *
 * WHY THE SERVER-SIDE COUNTER. `act` reports `{clicked: true}` when
 * `HTMLElement.click()` returns — which it does for a detached node, a disabled
 * control, or an element whose handler throws. Asserting that flag would leave this
 * journey green while every click silently did nothing. The fixture's button calls
 * `/hit/clicked`, so the oracle is the SERVER's count of requests it actually
 * received. The page cannot fake that and neither can the act result.
 *
 * WHY THE APPROVAL IS CLICKED, NOT INJECTED. Resolving the approval through the
 * store via `execute_js` would be easier and would also pass if the dialog were
 * wired to nothing. See e2e/lib/browserApproval.mjs.
 *
 * SEEN TO FAIL — three ways, all observed:
 *   1. Skip the approval and retry anyway → still refused, hit count stays 0.
 *   2. Point the act at a role/name that is not on the page → refused, count 0.
 *   3. Assert `hits > 0` before clicking → red, proving the counter is the oracle
 *      and not something that was already true.
 *
 * Safety: creates its own AI-owned tab against a LOCAL fixture (never the public
 * web) and tears it down by restoring `browser.enabled`, which disposes AI tabs and
 * their native views. Touches no documents and no user tabs. Restores every browser
 * setting it changed, including on failure.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";
import { waitForApprovalDialog, resolveApprovalViaUi } from "../lib/browserApproval.mjs";

export default {
  name: "browser-open-read-act",
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
        // --- B2: open + read -------------------------------------------------
        const open = await mcp.callTool("browser", { action: "open", url: fx.url("/") });
        if (open.isError) throw new Error(`open failed: ${open.text.slice(0, 300)}`);
        if (fx.hits("/") < 1) {
          throw new Error("the fixture page was never requested — open did not navigate");
        }

        const read = await mcp.callTool("browser", { action: "read" });
        if (read.isError) throw new Error(`read failed: ${read.text.slice(0, 300)}`);
        const names = (read.json?.snapshot ?? []).map((n) => n.name);
        if (!names.includes("Press Me")) {
          throw new Error(
            `ARIA snapshot did not name the fixture's button. Got: ${JSON.stringify(names).slice(0, 300)}`
          );
        }
        ctx.log(`read named ${names.length} elements`);

        // The oracle must be false before the act, or it proves nothing after.
        if (fx.hits("/hit/clicked") !== 0) {
          throw new Error("fixture click counter was already non-zero before acting");
        }

        // --- B7: ungranted act is refused, pending approval -------------------
        const first = await mcp.callTool("browser", {
          action: "act",
          operation: "click",
          role: "button",
          name: "Press Me",
        });
        if (!first.isError) {
          throw new Error("an ungranted click succeeded without any approval");
        }
        if (!/approval/i.test(first.text)) {
          throw new Error(`click was refused for the wrong reason: ${first.text.slice(0, 250)}`);
        }
        if (fx.hits("/hit/clicked") !== 0) {
          throw new Error("the page was clicked despite the action being refused");
        }

        // --- approve through the REAL dialog ---------------------------------
        const dialog = await waitForApprovalDialog(client);
        ctx.log(`approval dialog: ${dialog.origin ?? "(no origin shown)"}`);
        if (dialog.origin && !dialog.origin.includes("127.0.0.1")) {
          throw new Error(`dialog showed the wrong origin: ${dialog.origin}`);
        }
        await resolveApprovalViaUi(client, "allow-once");

        // --- B3: the retry lands, and the SERVER says so ----------------------
        const second = await mcp.callTool("browser", {
          action: "act",
          operation: "click",
          role: "button",
          name: "Press Me",
        });
        if (second.isError) {
          throw new Error(`click still refused after approval: ${second.text.slice(0, 250)}`);
        }

        // Poll: the click handler's fetch is async relative to the act returning.
        const deadline = Date.now() + 5000;
        while (fx.hits("/hit/clicked") === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (fx.hits("/hit/clicked") < 1) {
          throw new Error(
            "act reported success but the page never called the fixture — the click did not land"
          );
        }
        ctx.log(`server confirmed ${fx.hits("/hit/clicked")} click(s)`);
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
