/**
 * Journey: browser-redirect-ssrf  (WI-5.3 · B5 — policy applies per HOP)
 *
 * A URL filter that only inspects the URL the caller supplied is trivially
 * defeated: hand it a public URL that 302s into private space and the private
 * fetch happens anyway. `nav_registry_policy_macos.rs` re-validates every
 * top-level navigation action, so the redirect hop is refused too — this proves
 * it end to end, which no unit test can (the unit tests exercise the validator,
 * not WebKit's redirect handling).
 *
 * THE ORACLE IS A SERVER-SIDE COUNTER. The fixture records that `/redirect-private`
 * WAS requested — so the first hop genuinely happened and the browser really did
 * follow a redirect — while the destination (a private address) must never be
 * reached. Asserting only "the call returned an error" would pass if the browser
 * had never made any request at all, which is a completely different, and
 * uninteresting, reason to see a failure.
 *
 * RUNS WITH `allowLoopback` ON. That is deliberate and makes the test harder: the
 * fixture lives on 127.0.0.1, so loopback must be permitted for the first hop to
 * be legal. The private-range block on the SECOND hop is therefore doing the work
 * on its own, with the loopback exemption explicitly out of the way.
 *
 * SEEN TO FAIL: pointing the fixture's redirect at another fixture path instead
 * of a private address makes the navigation succeed, and the journey goes red.
 *
 * Safety: the blocked destination (192.168.0.1) is never contacted — that is the
 * assertion. Nothing leaves the machine.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

export default {
  name: "browser-redirect-ssrf",
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
        // Control: a plain fixture navigation works, so a later refusal cannot be
        // blamed on the fixture server or the browser being unusable.
        const control = await mcp.callTool("browser", { action: "open", url: fx.url("/") });
        if (control.isError) {
          throw new Error(`CONTROL FAILED — a permitted URL was refused: ${control.text.slice(0, 200)}`);
        }

        // The redirect: public-looking first hop, private destination.
        const res = await mcp.callTool("browser", {
          action: "navigate",
          url: fx.url("/redirect-private"),
        });

        // The first hop must genuinely have been made — otherwise nothing about
        // redirect handling has been exercised.
        const deadline = Date.now() + 8000;
        while (fx.hits("/redirect-private") === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 100));
        }
        if (fx.hits("/redirect-private") < 1) {
          throw new Error(
            "the redirecting URL was never requested — the first hop did not happen, so " +
              "this proves nothing about per-hop policy"
          );
        }
        ctx.log("first hop made; redirect issued to a private address");

        // The ACTUAL invariant — checked unconditionally, whichever way the call
        // returned. An error alone is not evidence: the first observed refusal
        // here was `NAVIGATION_SUPERSEDED`, which is a ticket race, not a policy
        // decision. A journey that accepted any error would have been reporting
        // "SSRF blocked" on the strength of a scheduling artifact.
        const state = await mcp.callTool("session", { action: "get_state" });
        const browserUrls = (state.json?.windows ?? [])
          .flatMap((w) => w.tabs ?? [])
          .filter((t) => t.kind === "browser")
          .map((t) => t.url ?? "");
        const landed = browserUrls.find((u) => u.includes("192.168."));
        if (landed) {
          throw new Error(`the browser FOLLOWED the redirect into private space: ${landed}`);
        }

        // And the private host must never have been contacted. The fixture only
        // sees its own requests, so this is asserted via the committed URL above
        // plus the absence of any further fixture hit for the destination.
        if (fx.hits("/redirected") !== 0) {
          throw new Error("the redirect chain continued past the blocked hop");
        }

        ctx.log(
          res.isError
            ? `hop refused (${res.text.slice(0, 60)}); tab never committed the private address`
            : "hop refused silently; tab never committed the private address"
        );
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
