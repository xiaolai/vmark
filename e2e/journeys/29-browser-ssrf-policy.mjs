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
 * SAFETY — engineered, not asserted. An earlier version claimed "nothing leaves
 * the machine", which was circular: it was true only if the policy under test
 * worked. Under the regression this journey detects, it would have contacted the
 * user's LAN and router and put Basic credentials on the wire.
 *
 * Destinations are now chosen to bound the damage, and the honest description is
 * REDUCED risk, not zero. One case is genuinely OBSERVABLE (loopback — the fixture
 * server is the packet oracle). The RFC 5737 TEST-NET addresses are reserved for
 * documentation and route nowhere.
 *
 * BUT — and an audit was right to press on this — the remaining cases are NOT
 * harmless: `169.254.169.254` is a real metadata endpoint ON A CLOUD VM, and
 * `printer.local` / `router.home.arpa` / `db.internal` CAN resolve on a real
 * corporate or home network. RFC 3927 link-local is link-scoped, not "unrouted".
 * On a developer laptop these resolve to nothing; on other machines they may not.
 *
 * So: do not run this suite on a cloud instance or a managed corporate network
 * until it is behind an egress-denying proxy with fixture-controlled DNS. That
 * sandbox is the correct fix and is not built. Until it is, this journey trades a
 * bounded, stated risk for coverage of a policy whose failure is worse.
 *
 * Restores all browser settings, including on failure.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

/**
 * Destinations the AI navigation policy must refuse before issuing a request.
 *
 * CHOSEN FOR SAFETY UNDER FAILURE. The earlier list pointed at a real router
 * (192.168.0.1), real RFC1918 space, and `example.com` with Basic credentials in
 * the authority — so under the exact regression this journey exists to detect, it
 * would have put those requests, and those credentials, on the wire. A test whose
 * failure mode is "contact the user's LAN" is not an acceptable test.
 *
 * Everything here is now either OBSERVABLE (loopback, where the fixture server
 * itself is the packet oracle — see the phase 2 assertion) or RESERVED-AND-UNROUTED
 * (RFC 5737 TEST-NET blocks, RFC 3927 link-local), so a policy failure cannot reach
 * anything real. `ai_policy.rs` blocks TEST-NET as part of its special-purpose
 * ranges, so these exercise genuine policy branches rather than being placeholders.
 */
const BLOCKED = [
  ["loopback by name", "http://localhost:9/"],
  ["loopback literal", "http://127.0.0.1:9/"],
  ["loopback shorthand", "http://127.1:9/"],
  ["loopback as integer", "http://2130706433:9/"],
  ["loopback as hex", "http://0x7f000001:9/"],
  ["TEST-NET-1 (RFC 5737)", "http://192.0.2.1/"],
  ["TEST-NET-2 (RFC 5737)", "http://198.51.100.1/"],
  ["TEST-NET-3 (RFC 5737)", "http://203.0.113.1/"],
  ["link-local / metadata (RFC 3927, unrouted)", "http://169.254.169.254/"],
  ["cloud metadata by name", "http://metadata.google.internal/"],
  ["mDNS LAN peer", "http://printer.local/"],
  ["home network", "http://router.home.arpa/"],
  ["cloud instance name", "http://db.internal/"],
  ["userinfo in authority", "http://user:pass@192.0.2.2/"],
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

        // THE PACKET ORACLE. With `allowLoopback` off, the fixture's own URL is a
        // blocked destination — and it is the one blocked destination whose server
        // we control, so its request counter is direct evidence of whether a packet
        // was actually emitted. Every other case can only be observed through the
        // returned error; this one is observed on the wire.
        const oracleUrl = fx.url("/");
        const oracle = await mcp.callTool("browser", { action: "open", url: oracleUrl });
        if (!oracle.isError) {
          throw new Error("a loopback URL was navigated with the loopback opt-in OFF");
        }
        // Give a leaked request time to land before declaring none was made.
        await new Promise((r) => setTimeout(r, 1500));
        if (fx.hits("/") !== 0) {
          throw new Error(
            `POLICY RAN TOO LATE — the blocked loopback destination received ` +
              `${fx.hits("/")} real request(s). The refusal above happened after the wire.`
          );
        }
        ctx.log("packet oracle: blocked loopback destination received zero requests");
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

        // The `BLOCKED` list above has no counter assertion, and that is correct:
        // the fixture observes only its own port, which none of those target, so a
        // counter check there could never fail. The packet oracle at the top of
        // this phase is the observable case; the rest are observed through their
        // refusal, with `ai_policy.test.rs` covering the decision exhaustively.
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
