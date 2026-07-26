/**
 * Journey: browser-occlusion  (WI-4.4 · B14 — freeze actually stops it occluding)
 *
 * The embedded browser is a NATIVE `WKWebView` added as a sibling of the Tauri
 * webview, so it paints above every piece of DOM regardless of z-index. Any app
 * surface that must appear over the browser rect — a modal, a menu, a context
 * menu — can only do so if the native view stops occluding first. That is what
 * `browser_freeze` is for, and the entire `services/browser/occlusion` layer
 * exists to drive it.
 *
 * WHY THIS IS NOT A FLAG READ-BACK. `browser_freeze` calls `setHidden(true)`;
 * asserting `isHidden === true` afterwards is very nearly a tautology and would be
 * an assertion that cannot fail. This asks AppKit `hitTest:` instead — *which view
 * is on top at this point?* — which walks the real hierarchy in z-order and skips
 * hidden views, the same visibility rule the compositor uses. It answers through a
 * path independent of the one that set the flag.
 *
 * WHY NOT PIXELS. A pixel oracle would be stronger and was attempted first. It is
 * not reachable: the debug bridge's window capture returns BLANK where the
 * `WKWebView` paints (proven by capturing a full-bleed magenta page two ways at
 * once — WebKit's own `takeSnapshot` returned magenta, the window capture returned
 * white), and `takeSnapshot` renders the view directly so it reports content
 * whether or not the view is composited. Neither observes compositing state. Hit
 * testing is the strongest oracle actually reachable from inside the process.
 *
 * DRIVEN THROUGH A REAL OVERLAY. An earlier version called `browser_freeze`
 * directly, which proved the primitive and left `services/browser/occlusion` —
 * the layer that DECIDES when to freeze — entirely unexercised. An audit was right
 * that B14 was overmarked on that basis. It now toggles the breakdown panel, a
 * genuine overlay wired through `useBrowserOccluder`, so the whole path from UI
 * intent to native hide is under test.
 *
 * THREE STATES, because two would not be enough: a freeze that DESTROYED the view
 * would satisfy "occludes" then "does not occlude" and still be a serious bug.
 *
 *   thawed  → occludes      (native view on top, as designed)
 *   frozen  → does NOT      (hidden; DOM can paint there)
 *   thawed  → occludes again (reversible, not a one-way teardown)
 *
 * SEEN TO FAIL: skipping the freeze leaves the point occluded and the journey goes
 * red on the frozen assertion — so the oracle is genuinely reading the native
 * view's visibility and not some incidental state.
 *
 * Safety: creates and closes its own browser page, ALWAYS thaws in a `finally` (a
 * leaked freeze would leave the user's browser invisible), and restores every
 * browser setting.
 */

import { evalJs } from "../lib/bridge.mjs";
import { poll } from "../lib/vmark.mjs";
import {
  withBrowserEnabled,
  openBrowserTabViaCommand,
  browserSurfaceCount,
  nativeBrowserTabIds,
  nativeOccludesPoint,
  invokeBrowserCommand,
} from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

export default {
  name: "browser-occlusion",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const fx = await startFixtureServer();
    let tabId = null;
    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        const before = await poll(
          () => browserSurfaceCount(client),
          (n) => n === 0,
          "no browser surfaces left over from a previous journey",
          { timeoutMs: 20000 }
        );
        const nativeBefore = await nativeBrowserTabIds(client);

        await openBrowserTabViaCommand(client);
        await poll(() => browserSurfaceCount(client), (n) => n > before, "browser surface", {
          timeoutMs: 10000,
        });
        const ids = await poll(
          () => nativeBrowserTabIds(client),
          (v) => v.length > nativeBefore.length,
          "native webview constructed",
          { timeoutMs: 15000 }
        );
        tabId = ids.find((id) => !nativeBefore.includes(id));
        if (!tabId) throw new Error("could not identify the native tab we just created");

        // Load a real page so the view has content and a settled frame.
        await evalJs(
          client,
          `(() => {
             const form = document.querySelector('.browser-omnibox-form');
             const input = form && form.querySelector('input');
             if (!input) return "NO_INPUT";
             const setter = Object.getOwnPropertyDescriptor(
               window.HTMLInputElement.prototype, 'value').set;
             setter.call(input, ${JSON.stringify(fx.url("/solid"))});
             input.dispatchEvent(new Event('input', { bubbles: true }));
             form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
             return "SUBMITTED";
           })()`
        );
        await poll(
          () => Promise.resolve(fx.hits("/solid")),
          (n) => n >= 1,
          "fixture page fetched",
          { timeoutMs: 12000 }
        );

        // --- thawed: the native view is on top ----------------------------
        const thawed = await poll(
          () => nativeOccludesPoint(client, tabId),
          (r) => r.occludes === true,
          "native view occludes the browser rect while thawed",
          { timeoutMs: 15000 }
        );
        ctx.log(`thawed: occluded by ${thawed.found}`);

        // --- frozen VIA A REAL OVERLAY ------------------------------------
        // [Audit Medium] Calling browser_freeze directly proves the PRIMITIVE and
        // leaves `services/browser/occlusion` — the thing that decides when to
        // freeze — completely unexercised. The breakdown panel is a real overlay
        // wired through `useBrowserOccluder`, so toggling it drives the actual
        // production path from UI intent to native hide.
        await evalJs(
          client,
          `(async () => {
             const run = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.runCommand;
             if (typeof run !== "function") return "NO_SEAM";
             await run("view.toggleBreakdown");
             return "OK";
           })()`
        );
        const frozen = await poll(
          () => nativeOccludesPoint(client, tabId),
          (r) => r.occludes === false,
          "native view no longer occludes once frozen",
          { timeoutMs: 15000 }
        );
        ctx.log(`frozen: point resolves to ${frozen.found} instead`);

        // --- thawed again by DISMISSING the overlay -----------------------
        await evalJs(
          client,
          `(async () => {
             const run = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.runCommand;
             await run("view.toggleBreakdown");
             return "OK";
           })()`
        );
        const rethawed = await poll(
          () => nativeOccludesPoint(client, tabId),
          (r) => r.occludes === true,
          "native view occludes again after thaw",
          { timeoutMs: 15000 }
        );
        ctx.log(`re-thawed: occluded by ${rethawed.found}`);

        // Teardown: close our page and confirm the native view is released.
        await evalJs(
          client,
          `(() => {
             const t = document.querySelector('.browser-page-tab.active') ||
                       document.querySelector('.browser-page-tab');
             const c = t && t.querySelector('.browser-page-tab-close');
             if (c) c.click();
             return true;
           })()`
        );
        await poll(
          () => nativeBrowserTabIds(client),
          (v) => !v.includes(tabId),
          "native webview released on close",
          { timeoutMs: 15000 }
        );
        tabId = null;
      });
    } finally {
      // Never exit frozen: a leaked freeze leaves the user's browser invisible.
      if (tabId) await invokeBrowserCommand(client, "browser_thaw", tabId).catch(() => {});
      await fx.close();
    }
  },
};
