/**
 * Journey: browser-session-roundtrip  (WI-5.5 · B6 — credential-by-reference)
 *
 * `session_save`/`session_load` let an AI reuse a login WITHOUT ever seeing the
 * credentials: values go to the OS keychain, the AI gets a handle and a count.
 * Both are `NEVER_GRANTABLE`, so each call needs a fresh per-call approval bound
 * to `action:handle` — an "Allow once" for `load:work` cannot be spent on
 * `load:other`.
 *
 * THE TRAP THIS JOURNEY EXISTS TO AVOID — and it is the reason the plan called
 * this row out specifically. The obvious shape is: save → navigate away → load →
 * assert the values are present. **That passes when `load` does nothing at all.**
 * Cookies and localStorage live in the webview's store and survive an ordinary
 * navigation, so "the values are there afterwards" is true whether or not the
 * restore ran. A green test here would have proven precisely nothing about the
 * credential path.
 *
 * So the sequence is: seed → save → **CLEAR AND PROVE ABSENT** → load → prove
 * present. The clear step is what makes the final assertion meaningful.
 *
 * TWO ORACLES, BOTH READ-ONLY. `/session` seeds on load, so it can never
 * distinguish "restored" from "re-seeded" — asserting on it after the load would
 * be the same false-oracle class, one step later. `/session-read` writes nothing
 * and only REPORTS what storage holds, so:
 *
 *   after clear → `ls=none;cookie=none`   (absence proven, not assumed)
 *   after load  → the seeded values back  (presence can only mean the restore ran)
 *
 * SEEN TO FAIL — two ways, both observed: skipping the clear makes the absence
 * assertion red (so the naive save→navigate→load shape cannot pass vacuously),
 * and skipping the `session_load` call leaves `ls=none` and the final assertion
 * goes red — which is precisely what the earlier version of this journey could
 * not detect.
 *
 * Safety: uses a journey-unique handle so it cannot collide with, or overwrite, a
 * real saved session; local fixture only; AI tab disposed by restoring
 * `browser.enabled`.
 */

import { evalJs } from "../lib/bridge.mjs";
import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";
import {
  waitForApprovalDialog,
  resolveApprovalViaUi,
  drainPendingApprovals,
} from "../lib/browserApproval.mjs";

/** Unique per run so a real user session can never be overwritten. */
const HANDLE = "vmark-e2e-fixture-session";

export default {
  name: "browser-session-roundtrip",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const fx = await startFixtureServer();
    const mcp = await startVmarkMcp();

    /** Run a per-call-approved session action: call, approve, retry. */
    async function approvedSession(action) {
      const first = await mcp.callTool("browser", { action, handle: HANDLE });
      if (!first.isError) return first; // already authorised (should not happen)
      if (!/approval/i.test(first.text)) {
        throw new Error(`${action} failed for a non-approval reason: ${first.text.slice(0, 200)}`);
      }
      await waitForApprovalDialog(client);
      await resolveApprovalViaUi(client, "allow-once");
      const retry = await mcp.callTool("browser", { action, handle: HANDLE });
      if (retry.isError) throw new Error(`${action} still refused: ${retry.text.slice(0, 220)}`);
      return retry;
    }

    /** Navigate to the READ-ONLY report page and return its marker. */
    async function gotoRead() {
      const nav = await mcp.callTool("browser", {
        action: "navigate",
        url: fx.url("/session-read"),
      });
      if (nav.isError && !/supersed/i.test(nav.text)) {
        throw new Error(`read navigation failed: ${nav.text.slice(0, 200)}`);
      }
      return marker();
    }

    /** Read the fixture page's own marker, which reports what storage holds. */
    async function marker() {
      const read = await mcp.callTool("browser", { action: "query", selector: "#marker" });
      if (read.isError) throw new Error(`query failed: ${read.text.slice(0, 200)}`);
      return read.json?.elements?.[0]?.text ?? "";
    }

    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        // 1. Seed: the fixture writes a cookie and a localStorage key.
        const open = await mcp.callTool("browser", { action: "open", url: fx.url("/session") });
        if (open.isError) throw new Error(`open failed: ${open.text.slice(0, 250)}`);
        const seeded = await marker();
        if (!seeded.includes("seeded")) {
          throw new Error(`fixture did not seed its session state: ${seeded}`);
        }
        ctx.log(`seeded: ${seeded}`);

        // 2. Save — value-free summary only.
        const saved = await approvedSession("session_save");
        if (/seeded/.test(saved.text)) {
          throw new Error("session_save leaked a stored VALUE into its response");
        }
        ctx.log("saved (counts only, no values)");
        await drainPendingApprovals(client);

        // 3. CLEAR — and prove absence. Without this the final assertion is
        //    satisfied by state that simply never went away.
        const clear = await mcp.callTool("browser", {
          action: "navigate",
          url: fx.url("/session-clear"),
        });
        if (clear.isError && !/supersed/i.test(clear.text)) {
          throw new Error(`clear navigation failed: ${clear.text.slice(0, 200)}`);
        }
        const cleared = await marker();
        if (!cleared.includes("none")) {
          throw new Error(`storage was not actually cleared — marker says: ${cleared}`);
        }
        ctx.log(`cleared and PROVEN absent: ${cleared}`);

        // 4. Same origin, READ-ONLY page. Confirms the clear really emptied the
        //    store (the clear page writes, so it is not its own witness).
        const readBefore = await gotoRead();
        if (!readBefore.includes("ls=none") || !readBefore.includes("cookie=none")) {
          throw new Error(`storage was not empty before the restore: ${readBefore}`);
        }

        // 5. Restore, then read again on the SAME read-only page.
        await approvedSession("session_load");
        await drainPendingApprovals(client);

        const readAfter = await gotoRead();
        if (!readAfter.includes("ls=seeded")) {
          throw new Error(
            `session_load succeeded but localStorage was NOT restored: ${readAfter}`
          );
        }
        ctx.log(`restored and verified: ${readAfter}`);
      });
    } finally {
      // The saved blob lives in the OS KEYCHAIN, which outlives the app, the
      // suite, and the machine reboot. Without this every run leaves another
      // entry behind — a test that quietly accumulates credentials-shaped state
      // in the user's keychain is not acceptable, even when the values are
      // fixture junk. `browser_forget_storage_state` is user-cleanup, so it
      // carries no driver gate and needs no approval.
      await evalJs(
        client,
        `(async () => {
           try {
             await window.__TAURI__.core.invoke('browser_forget_storage_state', {
               handle: ${JSON.stringify(HANDLE)},
             });
             return "OK";
           } catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
         })()`
      ).catch(() => {
        /* best-effort: never mask the journey's own failure with a cleanup one */
      });
      await mcp.close();
      await fx.close();
    }
  },
};
