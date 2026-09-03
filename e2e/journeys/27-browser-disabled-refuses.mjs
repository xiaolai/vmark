/**
 * Journey: browser-disabled-refuses  (WI-5.1 · AI browser feature gate)
 *
 * With the embedded browser switched OFF, every MCP browser action must refuse with
 * `BROWSER_DISABLED` and no native view may be created.
 *
 * WHY THIS JOURNEY CREATES ITS OWN PRECONDITION. The browser has shipped ON by
 * default since 2026-08-15, so the earlier version of this journey — which asserted
 * "the default-off gate" and skipped when the setting was on — skipped on every run
 * and the refusal path had no live test at all (audit 2026-09-03). It now switches
 * the browser off for its duration through the app's own settings mechanism and
 * restores the prior value in a `finally`, the way every browser journey does in the
 * other direction.
 *
 * WHY THE ARGUMENTS ARE VALID. Most of these actions also reject missing/blank
 * arguments, and an argument-validation error is indistinguishable from the feature
 * gate if you only assert "it failed". Every call below carries arguments that would
 * be ACCEPTED if the feature were on, so the only thing left to refuse them is the
 * gate itself. Read-class actions go through `browser_read`, the rest through
 * `browser` — the surface has been split since this journey was first written.
 *
 * WHY THE ERROR TOKEN IS ASSERTED. `BROWSER_DISABLED` is raised by the Rust policy
 * and mirrored by the frontend gate (`browserAccess.ts`). Matching the token — not
 * merely `isError` — is what distinguishes "the gate refused" from "something went
 * wrong".
 *
 * SEEN TO FAIL: with the `withBrowserDisabled` wrapper removed, `open` opens a tab and
 * `read` returns "no active browser tab"; the journey goes red on the token check.
 *
 * Safety: restores the browser setting; opens no tabs (the gate refuses them).
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserDisabled, nativeBrowserTabIds } from "../lib/browser.mjs";

export default {
  name: "browser-disabled-refuses",

  // macOS-only: on other platforms the native surface is an explicit stub, so
  // there is no gate behaviour here to cover (see runner `platforms` handling).
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }

    const mcp = await startVmarkMcp();
    try {
      await withBrowserDisabled(client, async () => {
        // Native map, not the DOM surface: a leaked or replaced WKWebView with an
        // unchanged DOM count would otherwise pass (audit).
        const nativeBefore = await nativeBrowserTabIds(client);

        // Every call is fully-formed: valid URL, valid operation, valid target.
        const cases = [
          ["browser", { action: "open", url: "https://example.com/" }],
          ["browser", { action: "navigate", url: "https://example.com/" }],
          ["browser", { action: "act", operation: "click", role: "button", name: "Press Me" }],
          ["browser", { action: "execute_js", script: "return 1" }],
          ["browser_read", { action: "read" }],
          ["browser_read", { action: "wait" }],
          ["browser_read", { action: "screenshot" }],
          ["browser_read", { action: "query", selector: "body" }],
          ["browser_read", { action: "console" }],
          ["browser_read", { action: "wait_for", text: "anything" }],
        ];

        for (const [tool, args] of cases) {
          const res = await mcp.callTool(tool, args);
          if (!res.isError) {
            throw new Error(`${tool} '${args.action}' succeeded while the browser is disabled`);
          }
          if (!/BROWSER_DISABLED/.test(res.text)) {
            throw new Error(
              `${tool} '${args.action}' failed for the WRONG reason — expected BROWSER_DISABLED, got: ${res.text.slice(0, 200)}`
            );
          }
        }

        // A refused action must not have constructed a native view on the way out.
        const nativeAfter = await nativeBrowserTabIds(client);
        const created = nativeAfter.filter((id) => !nativeBefore.includes(id));
        if (created.length) {
          throw new Error(
            `a native WKWebView was constructed while the browser is disabled: ${created.join(", ")}`
          );
        }
      });
    } finally {
      await mcp.close();
    }
  },
};
