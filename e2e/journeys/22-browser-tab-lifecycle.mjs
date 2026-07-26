/**
 * Journey: browser-tab-lifecycle  (WI-4.1/4.2 · B11/B12 — UI lane, Tauri bridge)
 *
 * Two invariants a user notices immediately when they break:
 *
 *   B11 closing a browser page tears down its NATIVE view. The `WKWebView` is a
 *       sibling of the Tauri webview, so a leaked one keeps running — loading,
 *       playing audio, holding a session — while looking closed.
 *   B12 the omnibox shows the COMMITTED url, not the one that was typed.
 *
 * WHY B11 IS NOT "THE DOM TAB IS GONE". That assertion would pass with the
 * native view fully alive: removing the React tab and destroying the WKWebView
 * are separate steps, and only the first is visible in a DOM snapshot. This
 * asserts the browser SURFACE count, which is the element the native view is
 * positioned against, and pairs it with the chrome disappearing.
 *
 * WHY B12 USES A REDIRECT. Navigating to a URL that loads unchanged proves
 * nothing — an omnibox that merely echoes what was typed passes. `/redirect`
 * lands on `/redirected`, so the typed and committed URLs DIFFER, and only a
 * committed-URL reading can be correct. The fixture's own hit counters confirm
 * which page was actually fetched.
 *
 * REQUIRES A DEV BUILD: creating a human browser tab needs the DEV-only
 * `__VMARK_DEBUG__.runCommand` seam (WI-4.0) — see e2e/lib/browser.mjs for why no
 * other route works. Against a release build the helper throws rather than
 * silently passing.
 *
 * SEEN TO FAIL: asserting the surface is gone BEFORE closing goes red; and
 * pointing B12 at `/` instead of `/redirect` makes the committed-URL assertion
 * vacuous, which is why the redirect is load-bearing rather than incidental.
 *
 * Safety: creates and closes its own browser page, restores every browser
 * setting including on failure, and touches no documents.
 */

import { evalJs } from "../lib/bridge.mjs";
import { poll } from "../lib/vmark.mjs";
import {
  withBrowserEnabled,
  openBrowserTabViaCommand,
  browserSurfaceCount,
} from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

/** Current omnibox URL text, or null when the browser chrome is not shown. */
function omniboxUrl(client) {
  return evalJs(
    client,
    `(() => {
       const form = document.querySelector('.browser-omnibox-form');
       if (!form) return null;
       const input = form.querySelector('input');
       return input ? input.value : null;
     })()`
  );
}

/** Close the active browser page through its own close control. */
function closeActiveBrowserPage(client) {
  return evalJs(
    client,
    `(() => {
       const tab = document.querySelector('.browser-page-tab.active') ||
                   document.querySelector('.browser-page-tab');
       if (!tab) return "NO_TAB";
       const close = tab.querySelector('.browser-page-tab-close');
       if (!close) return "NO_CLOSE";
       close.click();
       return "CLICKED";
     })()`
  );
}

export default {
  name: "browser-tab-lifecycle",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const fx = await startFixtureServer();
    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        // Establish a QUIESCENT baseline rather than assuming one. A previous
        // journey's AI tab may still be disposing when this starts, and a
        // baseline captured mid-teardown drifts underneath the assertions —
        // which is exactly how this journey passed alone and failed in sequence.
        const surfacesBefore = await poll(
          () => browserSurfaceCount(client),
          (n) => n === 0,
          "no browser surfaces left over from a previous journey",
          // 20s, not 10: native view disposal after a heavy AI-lane journey has
          // been observed taking longer than the shorter budget allowed, which
          // showed up as an INTERMITTENT failure here — passing in isolation and
          // failing in sequence. A too-tight teardown budget is indistinguishable
          // from a real leak in the report, so give it room.
          { timeoutMs: 20000 }
        );

        await openBrowserTabViaCommand(client);
        await poll(
          () => browserSurfaceCount(client),
          (n) => n > surfacesBefore,
          "browser surface created",
          { timeoutMs: 10000 }
        );
        ctx.log("browser page opened");

        // --- B12: committed URL, not the typed one -------------------------
        const typed = fx.url("/redirect");
        const navigated = await evalJs(
          client,
          `(() => {
             const form = document.querySelector('.browser-omnibox-form');
             if (!form) return "NO_FORM";
             const input = form.querySelector('input');
             if (!input) return "NO_INPUT";
             const setter = Object.getOwnPropertyDescriptor(
               window.HTMLInputElement.prototype, 'value').set;
             setter.call(input, ${JSON.stringify(typed)});
             input.dispatchEvent(new Event('input', { bubbles: true }));
             form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
             return "SUBMITTED";
           })()`
        );
        if (navigated !== "SUBMITTED") {
          throw new Error(`could not drive the omnibox: ${navigated}`);
        }

        // The redirect must actually have been followed, server-side.
        await poll(
          () => Promise.resolve(fx.hits("/redirected")),
          (n) => n >= 1,
          "redirect destination fetched",
          { timeoutMs: 12000 }
        );

        const shown = await poll(
          () => omniboxUrl(client),
          (v) => typeof v === "string" && v.includes("/redirected"),
          "omnibox shows the COMMITTED url",
          { timeoutMs: 12000 }
        );
        if (shown.includes("/redirect?") || shown.endsWith("/redirect")) {
          throw new Error(`omnibox echoed the typed URL instead of the committed one: ${shown}`);
        }
        ctx.log(`omnibox committed URL: ${shown}`);

        // --- B11: closing tears down the native view -----------------------
        const closed = await closeActiveBrowserPage(client);
        if (closed !== "CLICKED") throw new Error(`could not close the browser page: ${closed}`);

        await poll(
          () => browserSurfaceCount(client),
          (n) => n === surfacesBefore,
          "native browser surface torn down",
          { timeoutMs: 10000 }
        );
        ctx.log("browser surface torn down");
      });
    } finally {
      await fx.close();
    }
  },
};
