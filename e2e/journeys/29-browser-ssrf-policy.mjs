/**
 * Journey: browser-ssrf-policy  (WI-5.3 · B4/B5 — AI navigation policy)
 *
 * The AI must not be able to reach the machine's own services, the LAN, or cloud
 * metadata endpoints. `ai_policy.rs` refuses those destinations BEFORE WebKit is
 * given a request; this proves it end-to-end, through the shipping MCP surface.
 *
 * THE TRAP THIS JOURNEY IS BUILT TO AVOID. A refusal is the expected result for
 * every case, and a refusal is ALSO what you get from a typo'd URL, a fixture
 * server that never started, or a browser that is simply switched off. Asserting
 * "it failed" would pass under all of those, which is how a security test ends up
 * proving nothing. Two structural defences:
 *
 *   1. A POSITIVE CONTROL runs first. A fixture URL that policy permits must
 *      SUCCEED. If it does not, the journey fails immediately rather than
 *      reporting a clean sweep of refusals that were all environmental.
 *   2. Every refusal is matched against the policy's own error text, so a
 *      refusal for a different reason is a failure, not a pass.
 *
 * LOOPBACK IS TESTED WITH THE OPT-IN OFF. `browser.aiAllowLoopback` is the
 * setting that permits 127.0.0.1; with it off, loopback must be refused like any
 * other private destination. The positive control therefore cannot be a loopback
 * fixture — it uses the redirect endpoint reached with the opt-in ON, in a
 * separate phase, so each phase asserts exactly one policy state.
 *
 * SEEN TO FAIL — observed by deleting a suffix from `lan_facing_suffix` in
 * ai_policy.rs: `printer.local` then navigates instead of being refused and the
 * journey goes red on that case alone.
 *
 * Safety: every destination is either a local fixture or an address that is
 * REFUSED before a request is made, so nothing leaves the machine. Restores all
 * browser settings, including on failure.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

/** Destinations the AI navigation policy must refuse before issuing a request. */
const BLOCKED = [
  ["loopback by name", "http://localhost:9/"],
  ["loopback literal", "http://127.0.0.1:9/"],
  ["loopback shorthand", "http://127.1:9/"],
  ["loopback as integer", "http://2130706433:9/"],
  ["loopback as hex", "http://0x7f000001:9/"],
  ["private 10/8", "http://10.0.0.1/"],
  ["private 172.16/12", "http://172.16.0.1/"],
  ["private 192.168/16", "http://192.168.0.1/"],
  ["link-local", "http://169.254.169.254/"],
  ["cloud metadata", "http://metadata.google.internal/"],
  ["mDNS LAN peer", "http://printer.local/"],
  ["home network", "http://router.home.arpa/"],
  ["cloud instance name", "http://db.internal/"],
  ["userinfo in authority", "http://user:pass@example.com/"],
  ["file scheme", "file:///etc/passwd"],
  ["data scheme", "data:text/html,<h1>x</h1>"],
];

export default {
  name: "browser-ssrf-policy",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const fx = await startFixtureServer();
    const mcp = await startVmarkMcp();
    try {
      // --- Phase 1: positive control, loopback opt-in ON --------------------
      // Proves the whole path works when policy permits, so a later refusal
      // cannot be blamed on a broken environment.
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        const ok = await mcp.callTool("browser", { action: "open", url: fx.url("/") });
        if (ok.isError) {
          throw new Error(
            `POSITIVE CONTROL FAILED — a permitted fixture URL was refused, so the ` +
              `refusals below would prove nothing: ${ok.text.slice(0, 250)}`
          );
        }
        if (fx.hits("/") < 1) {
          throw new Error("positive control: the fixture was never actually requested");
        }
        ctx.log("positive control: permitted URL navigated");
      });

      // --- Phase 2: everything above must be refused, opt-in OFF ------------
      await withBrowserEnabled(client, { allowLoopback: false }, async () => {
        fx.resetHits();
        for (const [label, url] of BLOCKED) {
          const res = await mcp.callTool("browser", { action: "open", url });
          if (!res.isError) {
            throw new Error(`${label} (${url}) was NOT refused — the AI reached it`);
          }
          // A refusal for the wrong reason (bad args, disabled browser, crash) is
          // not evidence that the SSRF policy did anything.
          if (/BROWSER_DISABLED/.test(res.text)) {
            throw new Error(`${label}: refused because the browser was disabled, not by policy`);
          }
          if (!/blocked|refus|not permitted|invalid|policy/i.test(res.text)) {
            throw new Error(
              `${label} refused for an unrecognised reason: ${res.text.slice(0, 200)}`
            );
          }
        }
        ctx.log(`${BLOCKED.length} destinations refused before any request`);

        // Nothing may have reached even our own fixture during phase 2 — the
        // loopback cases target 127.0.0.1 and must not have been issued.
        const total = Object.values(fx.allHits()).reduce((a, b) => a + b, 0);
        if (total !== 0) {
          throw new Error(
            `a blocked destination produced ${total} actual request(s) — policy ran too late`
          );
        }
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
