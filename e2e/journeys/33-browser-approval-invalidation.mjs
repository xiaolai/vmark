/**
 * Journey: browser-approval-invalidation  (WI-5.10 · B10 — consent does not travel)
 *
 * An approval is bound to the page the user was LOOKING AT. If it survived a
 * navigation, the sequence "AI asks to click Buy on shop.example → page navigates
 * → user clicks Allow" would authorise a click on a page they never saw. The
 * driver binds every one-shot to `(tab, generation)` and the generation advances
 * on commit, so a navigation invalidates unspent authority; `browser_add_one_shot`
 * additionally refuses to mint against a stale generation ("stale approval").
 *
 * This journey drives that from the outside: raise a prompt, navigate, then show
 * that neither the pending prompt nor any late approval can authorise the action.
 *
 * WHY THE RETRY IS THE ORACLE. Whether the dialog is still on screen is a UI
 * detail; whether the ACTION can happen is the security property. The final
 * assertion is that the click is still refused after a navigate-then-approve
 * sequence — that holds whether the prompt was dismissed, ignored, or approved
 * too late.
 *
 * SEEN TO FAIL: skipping the navigation makes the post-approval click succeed —
 * which is correct behaviour for a same-page approval and confirms the navigation
 * is what does the invalidating here, not some unrelated refusal.
 *
 * Safety: local fixture; AI tab disposed by restoring `browser.enabled`.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";
import { readApprovalDialog, waitForApprovalDialog, resolveApprovalViaUi } from "../lib/browserApproval.mjs";

const BUTTON = { role: "button", name: "Press Me" };

export default {
  name: "browser-approval-invalidation",
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

        // Raise a prompt the user has not answered yet.
        const first = await mcp.callTool("browser", { action: "act", operation: "click", ...BUTTON });
        if (!first.isError) throw new Error("an ungranted click succeeded with no approval");
        await waitForApprovalDialog(client);
        ctx.log("approval prompt raised");

        // The page moves under the pending prompt.
        const nav = await mcp.callTool("browser", { action: "navigate", url: fx.url("/second") });
        if (nav.isError && !/supersed/i.test(nav.text)) {
          throw new Error(`navigation failed unexpectedly: ${nav.text.slice(0, 200)}`);
        }
        await new Promise((r) => setTimeout(r, 1200));
        ctx.log("tab navigated while the prompt was pending");

        // Try to answer it late. Either the prompt is already gone (dismissed on
        // navigation) or the mint is refused as stale — both are correct, and
        // neither may authorise the action.
        const stillShowing = await readApprovalDialog(client);
        if (stillShowing) {
          await resolveApprovalViaUi(client, "allow-once").catch(() => {
            /* dismissed underneath us — equally valid */
          });
          ctx.log("late approval attempted");
        } else {
          ctx.log("prompt was dismissed by the navigation");
        }

        // THE ORACLE: the action must still be refused, and the page must not
        // have been clicked.
        const retry = await mcp.callTool("browser", { action: "act", operation: "click", ...BUTTON });
        if (!retry.isError) {
          throw new Error(
            "a click was authorised by an approval raised BEFORE the page navigated — " +
              "consent travelled across pages"
          );
        }
        if (fx.hits("/hit/clicked") !== 0) {
          throw new Error("the page was clicked despite the approval being invalidated");
        }
        ctx.log("post-navigation click refused; consent did not travel");
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
