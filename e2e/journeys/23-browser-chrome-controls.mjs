/**
 * Journey: browser-chrome-controls  (WI-4.3 · B13 — back / forward / reload)
 *
 * The navigation controls must actually navigate. The tempting assertion —
 * "the Back button became enabled" — proves only that a store flag flipped, and
 * a chrome that renders enabled buttons wired to nothing would sail through it.
 *
 * THE ORACLE IS THE COMMITTED URL PLUS SERVER HITS. Each fixture page is a
 * distinct path, so history position is observable from outside the app: the
 * omnibox reports where the tab actually is, and the fixture server counts how
 * many times each page was fetched (reload must increment; back/forward may be
 * served from the back-forward cache, so only the URL is asserted for those).
 *
 * REQUIRES A DEV BUILD for the `__VMARK_DEBUG__.runCommand` seam (WI-4.0).
 *
 * SEEN TO FAIL: replacing the Back click with a no-op leaves the committed URL
 * on `/second` and the journey goes red on the first assertion.
 *
 * Safety: creates and closes its own browser page; restores browser settings
 * including on failure; touches no documents.
 */

import { evalJs } from "../lib/bridge.mjs";
import { poll } from "../lib/vmark.mjs";
import { withBrowserEnabled, openBrowserTabViaCommand, browserSurfaceCount } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

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

function navigateTo(client, url) {
  return evalJs(
    client,
    `(() => {
       const form = document.querySelector('.browser-omnibox-form');
       if (!form) return "NO_FORM";
       const input = form.querySelector('input');
       const setter = Object.getOwnPropertyDescriptor(
         window.HTMLInputElement.prototype, 'value').set;
       setter.call(input, ${JSON.stringify(url)});
       input.dispatchEvent(new Event('input', { bubbles: true }));
       form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
       return "SUBMITTED";
     })()`
  );
}

/** Click a chrome button by its accessible name (Back / Forward / Reload). */
function clickChrome(client, namePattern) {
  return evalJs(
    client,
    `(() => {
       const btns = [...document.querySelectorAll('.browser-omnibox button')];
       const re = ${namePattern};
       const btn = btns.find((b) => re.test(
         (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim()
       ));
       if (!btn) return "NO_BUTTON:" + btns.map((b) =>
         (b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '').trim()).join('|');
       if (btn.disabled) return "DISABLED";
       btn.click();
       return "CLICKED";
     })()`
  );
}

const atUrl = (client, fragment) =>
  poll(
    () => omniboxUrl(client),
    (v) => typeof v === "string" && v.includes(fragment),
    `committed URL contains ${fragment}`,
    { timeoutMs: 12000 }
  );

export default {
  name: "browser-chrome-controls",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    const fx = await startFixtureServer();
    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        // Quiescent baseline — see the note in 22-browser-tab-lifecycle.
        const before = await poll(
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
        await poll(() => browserSurfaceCount(client), (n) => n > before, "browser surface", {
          timeoutMs: 10000,
        });

        // Everything below runs against the page we just opened, and the page is
        // closed in the `finally` — a journey that fails half-way used to leave it
        // behind, and the NEXT journey's "no surfaces left over" baseline then
        // reported the leak as its own failure.
        try {
        // Build a two-entry history: "/" then "/second".
        if ((await navigateTo(client, fx.url("/"))) !== "SUBMITTED") {
          throw new Error("could not drive the omnibox");
        }
        await atUrl(client, "127.0.0.1");
        await navigateTo(client, fx.url("/second"));
        await atUrl(client, "/second");
        ctx.log("history built: / -> /second");

        // --- Back --------------------------------------------------------
        const back = await clickChrome(client, "/back/i");
        if (back !== "CLICKED") throw new Error(`Back not clickable: ${back}`);
        const afterBack = await atUrl(client, "127.0.0.1");
        if (afterBack.includes("/second")) {
          throw new Error(`Back did not navigate — still on ${afterBack}`);
        }
        ctx.log("back navigated");

        // --- Forward -----------------------------------------------------
        const fwd = await clickChrome(client, "/forward/i");
        if (fwd !== "CLICKED") throw new Error(`Forward not clickable: ${fwd}`);
        await atUrl(client, "/second");
        ctx.log("forward navigated");

        // --- Reload: the SERVER must see another request ------------------
        const hitsBefore = fx.hits("/second");
        const reload = await clickChrome(client, "/reload|refresh/i");
        if (reload !== "CLICKED") throw new Error(`Reload not clickable: ${reload}`);
        await poll(
          () => Promise.resolve(fx.hits("/second")),
          (n) => n > hitsBefore,
          "reload re-fetched the page from the server",
          { timeoutMs: 12000 }
        );
        ctx.log(`reload re-fetched (${hitsBefore} -> ${fx.hits("/second")})`);
        } finally {
          // Teardown: close the page we opened.
          await evalJs(
            client,
            `(() => {
               const tab = document.querySelector('.browser-page-tab.active') ||
                           document.querySelector('.browser-page-tab');
               const close = tab && tab.querySelector('.browser-page-tab-close');
               if (close) close.click();
               return true;
             })()`
          );
          await poll(() => browserSurfaceCount(client), (n) => n === before, "surface torn down", {
            timeoutMs: 10000,
          });
        }
      });
    } finally {
      await fx.close();
    }
  },
};
