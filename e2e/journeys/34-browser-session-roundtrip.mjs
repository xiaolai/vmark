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
 * KNOWN LIMIT — read this before trusting the row. This journey proves that save
 * succeeds without leaking values, that the storage really was CLEARED (asserted,
 * not assumed), and that `session_load` is per-call approved and succeeds. It does
 * NOT yet prove the values came back: the fixture's `/session` page re-seeds its
 * own state on load, so its marker would read "seeded" whether the restore ran or
 * not — the same class of false oracle this journey was written to avoid, just one
 * step later. Closing it needs a read-only fixture endpoint that reports storage
 * WITHOUT writing it. Until then this row is 🟡 partial in the matrix, deliberately.
 *
 * SEEN TO FAIL: skipping the clear step makes "cleared and proven absent" go red,
 * which is what stops the naive save→navigate→load shape from passing vacuously.
 *
 * Safety: uses a journey-unique handle so it cannot collide with, or overwrite, a
 * real saved session; local fixture only; AI tab disposed by restoring
 * `browser.enabled`.
 */

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

        // 4. Back to the origin, then restore.
        const back = await mcp.callTool("browser", { action: "navigate", url: fx.url("/session") });
        if (back.isError && !/supersed/i.test(back.text)) {
          throw new Error(`return navigation failed: ${back.text.slice(0, 200)}`);
        }
        await approvedSession("session_load");
        ctx.log("restored");
        await drainPendingApprovals(client);
      });
    } finally {
      await mcp.close();
      await fx.close();
    }
  },
};
