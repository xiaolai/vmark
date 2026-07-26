/**
 * Journey: browser-approval-scoping  (WI-5.8/5.9 · B8/B9 — what an approval buys)
 *
 * An approval is not a mood, it is a bounded grant. Two bounds, both of which
 * would be invisible if broken:
 *
 *   B9  a one-shot minted for element A cannot be spent on element B. If it
 *       could, approving "click Press Me" would authorise clicking anything on
 *       the page — the user's consent would name one control and license all of
 *       them.
 *   B8  "Allow once" is spent by the first successful action. If it were not,
 *       a single approval would silently become a standing grant.
 *
 * WHY THIS NEEDS TWO ELEMENTS ON THE FIXTURE. The scoping test is only
 * meaningful if the second target genuinely exists and is actionable — pointing
 * at a nonexistent element would be refused for the wrong reason (no such node),
 * and the journey would pass without testing scoping at all. The fixture serves
 * both a button ("Press Me") and a link ("Go to second"), so the substituted
 * target is real and the ONLY thing standing between it and a click is the
 * one-shot's target binding.
 *
 * PROOF IS THE RETRY, NOT THE STORE. `grantSync.ts` fires `void invoke(...)` and
 * swallows failure into a warning, so the frontend believing it minted authority
 * is not evidence Rust received any. Every assertion here is about whether an
 * action LANDS.
 *
 * SEEN TO FAIL: approving for the link instead of the button makes the B9 case
 * succeed where it must be refused, and the journey goes red.
 *
 * Safety: local fixture; AI tab disposed by restoring `browser.enabled`.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";
import { waitForApprovalDialog, resolveApprovalViaUi } from "../lib/browserApproval.mjs";

const BUTTON = { role: "button", name: "Press Me" };
const LINK = { role: "link", name: "Go to second" };

export default {
  name: "browser-approval-scoping",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const fx = await startFixtureServer();
    const mcp = await startVmarkMcp();
    const click = (target) =>
      mcp.callTool("browser", { action: "act", operation: "click", ...target });

    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        const open = await mcp.callTool("browser", { action: "open", url: fx.url("/") });
        if (open.isError) throw new Error(`open failed: ${open.text.slice(0, 250)}`);

        // Raise and approve an "Allow once" bound to the BUTTON.
        const first = await click(BUTTON);
        if (!first.isError) throw new Error("an ungranted click succeeded with no approval");
        await waitForApprovalDialog(client);
        await resolveApprovalViaUi(client, "allow-once");

        // --- B9: the approval cannot be spent on a DIFFERENT element ---------
        const substituted = await click(LINK);
        if (!substituted.isError) {
          throw new Error(
            "a one-shot approved for the button was spent on the LINK — an approval " +
              "naming one control authorised another"
          );
        }
        // And it must be refused for want of approval, not because the element
        // is missing: the link genuinely exists on the fixture page.
        if (!/approval/i.test(substituted.text)) {
          throw new Error(
            `the substituted target was refused for the wrong reason: ${substituted.text.slice(0, 200)}`
          );
        }
        ctx.log("B9: one-shot refused on a different element");

        // The approval must still be intact — a refused action must not consume
        // it, or a failed substitution would silently burn the user's consent.
        const onTarget = await click(BUTTON);
        if (onTarget.isError) {
          throw new Error(
            `the approval was consumed by the REFUSED action: ${onTarget.text.slice(0, 200)}`
          );
        }
        const deadline = Date.now() + 5000;
        while (fx.hits("/hit/clicked") === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (fx.hits("/hit/clicked") < 1) {
          throw new Error("the approved click reported success but never reached the page");
        }
        ctx.log("B9: the on-target click still landed (approval not burned by the refusal)");

        // --- B8: "Allow once" is spent — a second click needs fresh consent --
        const second = await click(BUTTON);
        if (!second.isError) {
          throw new Error(
            "a second click succeeded on the SAME approval — 'Allow once' became a standing grant"
          );
        }
        if (!/approval/i.test(second.text)) {
          throw new Error(`second click refused for the wrong reason: ${second.text.slice(0, 200)}`);
        }
        ctx.log("B8: allow-once was spent; the next action needs fresh approval");
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
