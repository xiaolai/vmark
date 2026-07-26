/**
 * Journey: browser-disabled-refuses  (WI-5.1 · AI browser feature gate)
 *
 * The embedded browser is OFF by default. Every MCP action must refuse with
 * `BROWSER_DISABLED` and no native view may be created.
 *
 * WHY THE ARGUMENTS ARE VALID. The obvious version of this test sends
 * `{action:"read"}` with nothing else and calls the refusal a pass. But most of
 * these actions also reject missing/blank arguments, and an argument-validation
 * error is indistinguishable from the feature gate if you only assert "it failed".
 * Every call below therefore carries arguments that would be ACCEPTED if the
 * feature were on, so the only thing left to refuse them is the gate itself.
 *
 * WHY THE ERROR STRING IS ASSERTED EXACTLY. `BROWSER_DISABLED` is raised by the
 * Rust policy (`authorize.rs`) and mirrored by the frontend handler. Matching the
 * token — not merely `isError` — is what distinguishes "the gate refused" from
 * "something went wrong".
 *
 * SEEN TO FAIL: verified by flipping `browser.enabled` on before the loop; the
 * read/open/navigate cases then return "no active browser tab" / a navigation
 * result instead of `BROWSER_DISABLED`, and the journey goes red.
 *
 * Safety: reads the browser setting but never changes it — this journey asserts
 * the DEFAULT state, so it must not create the state it is testing. It opens no
 * tabs and touches no documents.
 */

import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { readBrowserSettings, browserSurfaceCount } from "../lib/browser.mjs";

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

    const settings = await readBrowserSettings(client);
    if (settings?.enabled === true) {
      // Do not silently turn it off: that would rewrite the user's configuration
      // to manufacture the precondition, and the assertion would then be about a
      // state this journey created rather than the shipped default.
      return { skip: "browser.enabled is ON; this journey asserts the default-off gate" };
    }

    const surfacesBefore = await browserSurfaceCount(client);
    const mcp = await startVmarkMcp();
    try {
      // Every call is fully-formed: valid URL, valid operation, valid target.
      const cases = [
        ["read", {}],
        ["open", { url: "https://example.com/" }],
        ["navigate", { url: "https://example.com/" }],
        ["act", { operation: "click", role: "button", name: "Press Me" }],
        ["wait", {}],
        ["screenshot", {}],
        ["query", { selector: "body" }],
        ["console", {}],
      ];

      for (const [action, args] of cases) {
        const res = await mcp.callTool("browser", { action, ...args });
        if (!res.isError) {
          throw new Error(`action '${action}' succeeded while the browser is disabled`);
        }
        if (!/BROWSER_DISABLED/.test(res.text)) {
          throw new Error(
            `action '${action}' failed for the WRONG reason — expected BROWSER_DISABLED, got: ${res.text.slice(0, 200)}`
          );
        }
      }

      // A refused action must not have constructed a native view on the way out.
      const surfacesAfter = await browserSurfaceCount(client);
      if (surfacesAfter !== surfacesBefore) {
        throw new Error(
          `native browser surfaces changed while disabled: ${surfacesBefore} → ${surfacesAfter}`
        );
      }
    } finally {
      await mcp.close();
    }
  },
};
