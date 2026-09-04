/**
 * Journey: browser-secondary-window-teardown  (audit 20260903 #36 — teardown.rs)
 *
 * The window-destroy orchestration (`src-tauri/src/browser/teardown.rs`) had unit
 * tests for its two map helpers and nothing for the thing itself: a browser tab in a
 * SECONDARY window, that window destroyed, and the three things that must be true
 * afterwards — the native view is gone, the driver holds no authority for the tab,
 * and the bookkeeping no longer knows it. This journey does exactly that against the
 * real app.
 *
 * Oracles, each independent of the others:
 *   - `browser_debug_native_tab_ids` — the app's own map of live native views
 *     (the same oracle journey 22 uses; a DOM check would be blind to a leaked view);
 *   - `browser_ai_state` — the registry's authority record, which must answer
 *     TAB_NOT_FOUND once the window is gone;
 *   - the MCP surface — an `act` on the dead tab must be refused, not performed;
 *   - `browser_debug_attached_webviews` on the MAIN window — unchanged, so nothing
 *     leaked into the surviving window.
 *
 * How the tab reaches the secondary window: `open_workspace_in_new_window` creates
 * a document window, and the DEV seam (`__VMARK_DEBUG__.runCommand`) is run INSIDE
 * that window's own webview (`execute_js` targets it by `windowLabel`), so the tab is
 * created by that realm and its native view is parented to that window — no
 * dependence on which window the OS happens to focus (the MCP `open` routes by
 * focus, and a headless run cannot promise it). The journey asserts where the
 * view landed before it destroys anything.
 *
 * The tab is then pointed at a LOCAL fixture page whose button counts clicks, so
 * the act oracle measures a page the dead tab actually held, not a page it never
 * loaded.
 *
 * Safety: its own temporary workspace directory, its own tab against a LOCAL
 * fixture, its own window; every browser setting restored, window closed and the
 * directory removed on every path.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evalJs, listWindows } from "../lib/bridge.mjs";
import { startVmarkMcp, bridgeReady } from "../lib/vmarkMcp.mjs";
import { withBrowserEnabled, nativeBrowserTabIds, attachedWebviewCount } from "../lib/browser.mjs";
import { startFixtureServer } from "../lib/fixtureServer.mjs";

/** Invoke a Tauri command from the main webview: "OK" for a unit result, the JSON of
 *  any other value, or "ERR <message>" for a rejection. */
async function invokeFromApp(client, command, args) {
  return evalJs(
    client,
    `(async () => {
       try {
         const v = await window.__TAURI__.core.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)});
         // A unit-returning command resolves with null (the Rust unit), not undefined.
         return v === undefined || v === null ? "OK" : JSON.stringify(v);
       } catch (e) {
         // A typed CommandError rejects as an OBJECT ({code, message, detail}): keep the
         // whole thing, the token lives in detail.mcpCode, not in the prose.
         return "ERR " + (e && typeof e === "object" ? JSON.stringify(e) : String(e));
       }
     })()`,
  );
}

async function pollUntil(label, predicate, timeoutMs = 10_000, stepMs = 200) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export default {
  name: "browser-secondary-window-teardown",
  platforms: ["darwin"],
  coverageRequired: true,

  async run(client, ctx) {
    if (!(await bridgeReady())) {
      return { skip: "VMark MCP bridge is not advertising a port" };
    }
    const fx = await startFixtureServer();
    const mcp = await startVmarkMcp();
    const workspace = mkdtempSync(join(tmpdir(), "vmark-e2e-second-window-"));
    let secondary = null;
    try {
      await withBrowserEnabled(client, { allowLoopback: true }, async () => {
        const mainAttachedBefore = await attachedWebviewCount(client, "main");
        const before = new Set((await listWindows(client)).map((w) => w.label));

        // --- a secondary window, focused ------------------------------------
        const created = await invokeFromApp(client, "open_workspace_in_new_window", {
          workspaceRoot: workspace,
          filePath: null,
        });
        if (typeof created !== "string" || created.startsWith("ERR ")) {
          throw new Error(`open_workspace_in_new_window failed: ${created}`);
        }
        secondary = JSON.parse(created);
        await pollUntil("the secondary window to be listed", async () =>
          (await listWindows(client)).some((w) => w.label === secondary && !before.has(w.label)),
        );
        ctx.log(`secondary window ${secondary}`);
        // Give the new webview its bootstrap: the DEV seam is installed by the app shell.
        await new Promise((r) => setTimeout(r, 1500));

        // --- a browser tab created BY the secondary window --------------------
        const nativeBefore = new Set(await nativeBrowserTabIds(client));
        const opened = await client.send(
          "execute_js",
          {
            windowLabel: secondary,
            script: `(async () => {
              const run = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.runCommand;
              if (typeof run !== "function") return "NO_SEAM";
              // The seam's third argument is the window the command runs FOR; it
              // defaults to "main", which would create the tab under the wrong label.
              try { await run("browser.newTab", undefined, ${JSON.stringify(secondary)}); return "OK"; }
              catch (e) { return "ERR " + (e && e.message ? e.message : String(e)); }
            })()`,
          },
          15000,
        );
        if (opened?.success !== true || opened.data !== "OK") {
          throw new Error(`browser.newTab in ${secondary} failed: ${JSON.stringify(opened).slice(0, 300)}`);
        }
        let tabId = null;
        await pollUntil("the secondary window's tab to get a native view", async () => {
          const fresh = (await nativeBrowserTabIds(client)).filter((id) => !nativeBefore.has(id));
          if (fresh.length === 1) tabId = fresh[0];
          return tabId !== null;
        });
        const inSecondary = await attachedWebviewCount(client, secondary);
        if (inSecondary !== 1) {
          throw new Error(
            `expected exactly one native view in ${secondary}, found ${inSecondary} ` +
              `(main has ${await attachedWebviewCount(client, "main")})`,
          );
        }
        if ((await attachedWebviewCount(client, "main")) !== mainAttachedBefore) {
          throw new Error("creating a tab in the secondary window changed the main window's native views");
        }
        ctx.log(`tab ${tabId} live in ${secondary}`);

        // --- point it at the fixture, so the act oracle has a page to measure ---
        const navigated = await invokeFromApp(client, "browser_navigate", { tabId, url: fx.url("/") });
        if (navigated !== "OK") throw new Error(`browser_navigate failed: ${navigated}`);
        // The chrome shows the page's host in its URL field and, until a title
        // arrives, as the tab label — so the host is the thing to wait for.
        const fixtureHost = new URL(fx.url("/")).host;
        await pollUntil("the fixture page to load in the secondary window", async () => {
          const r = await client.send(
            "execute_js",
            {
              windowLabel: secondary,
              script: `(() => {
                const host = ${JSON.stringify(fixtureHost)};
                if ((document.body.innerText || "").includes(host)) return true;
                return [...document.querySelectorAll("input")].some((i) => (i.value || "").includes(host));
              })()`,
            },
            15000,
          );
          return r?.success === true && r.data === true;
        });

        // --- destroy the window ---------------------------------------------
        const closed = await invokeFromApp(client, "close_window", { label: secondary });
        if (closed !== "OK") throw new Error(`close_window failed: ${closed}`);
        await pollUntil("the secondary window to disappear", async () =>
          !(await listWindows(client)).some((w) => w.label === secondary),
        );
        secondary = null;

        // --- the three oracles ----------------------------------------------
        const tornDownAt = Date.now();
        await pollUntil(
          "the native view to be torn down",
          async () => !(await nativeBrowserTabIds(client)).includes(tabId),
        );
        ctx.log(`native view gone ${Date.now() - tornDownAt} ms after the window`);
        const stateAfter = await invokeFromApp(client, "browser_ai_state", { tabId });
        if (!stateAfter.startsWith("ERR ") || !stateAfter.includes("TAB_NOT_FOUND")) {
          throw new Error(`the registry still answers for the dead tab: ${stateAfter.slice(0, 200)}`);
        }
        const act = await mcp.callTool("browser", {
          action: "act",
          operation: "click",
          role: "button",
          name: "Press Me",
          tabId,
        });
        if (!act.isError) throw new Error(`an act on the dead tab was not refused: ${act.text.slice(0, 200)}`);
        if (!act.text.includes("TAB_NOT_FOUND")) {
          throw new Error(`the dead tab was refused for the wrong reason: ${act.text.slice(0, 200)}`);
        }
        if (fx.hits("/hit/clicked") !== 0) throw new Error("the dead tab's page received a click");
        const mainAttachedAfter = await attachedWebviewCount(client, "main");
        if (mainAttachedAfter !== mainAttachedBefore) {
          throw new Error(`the main window's native views changed (${mainAttachedBefore} → ${mainAttachedAfter}); a view leaked across windows`);
        }
        ctx.log("native view gone, authority gone, main window untouched");
      });
    } finally {
      if (secondary) await invokeFromApp(client, "close_window", { label: secondary }).catch(() => {});
      // The temporary workspace went into the persisted recents when its window
      // opened; take it out through the store's own action (DEV seam), so the run
      // leaves no dead "Open Recent" entry behind.
      await evalJs(
        client,
        `(() => { const f = window.__VMARK_DEBUG__ && window.__VMARK_DEBUG__.forgetRecentWorkspace;
           if (typeof f === "function") f(${JSON.stringify(workspace)}); return "OK"; })()`,
      ).catch(() => {});
      await mcp.close?.();
      await fx.close?.();
      rmSync(workspace, { recursive: true, force: true });
    }
  },
};
