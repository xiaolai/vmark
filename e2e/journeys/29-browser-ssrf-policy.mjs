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
 * SAFETY — stated honestly, because the obvious claim is circular. "Nothing
 * leaves the machine" is only true IF the policy under test works; under the exact
 * regression this journey exists to catch, it would contact the LAN, a router,
 * link-local metadata, and an internal DNS name, and the userinfo case could put
 * Basic credentials on the wire. That is a real hazard of testing egress policy
 * from a machine with egress. Running this inside an egress-denied sandbox (or
 * behind an intercepting proxy) is the correct environment and is NOT yet set up —
 * treat a failure of this journey as potentially having emitted those requests.
 *
 * Restores all browser settings, including on failure.
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
          // Narrow: the policy's own vocabulary, not any error that mentions
          // "invalid". A malformed-URL rejection is a DIFFERENT bug class and must
          // not be able to stand in for an SSRF block.
          if (!/SSRF_BLOCKED|blocked|not permitted|refused by policy/i.test(res.text)) {
            throw new Error(
              `${label} refused for an unrecognised reason — expected a policy block, got: ${res.text.slice(0, 200)}`
            );
          }
        }
        ctx.log(`${BLOCKED.length} destinations refused before any request`);

        // NOTE — there is deliberately no request-counter assertion here. The
        // fixture server observes ONLY its own ephemeral port, and not one blocked
        // URL above targets it, so `allHits() === 0` is structurally always true:
        // an assertion that cannot fail. (It was one, until this audit.) Proving
        // "no packet left the machine" needs an egress-denied sandbox or a local
        // intercepting proxy — see the safety note in the header.
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
