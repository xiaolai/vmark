/**
 * Journey: boot-editor-ready (read-only)
 *
 * Verifies the live app is in a drivable state: the bridge reports a window,
 * the document webview hosts a ProseMirror surface, the Tauri event channel
 * (used by every other journey) is live, and the tab bar renders exactly one
 * active tab. Mutates nothing.
 */

import { expectSuccess, evalJs } from "../lib/bridge.mjs";
import { getTabs } from "../lib/vmark.mjs";

export default {
  name: "boot-editor-ready",

  async run(client, ctx) {
    const windows = expectSuccess(
      await client.send("list_windows", {}, ctx.cfg.timeoutMs),
      "list_windows"
    );
    const list = Array.isArray(windows) ? windows : windows?.windows;
    if (!Array.isArray(list) || list.length === 0) {
      throw new Error(`no windows reported: ${JSON.stringify(windows)}`);
    }
    ctx.log(`${list.length} window(s), main label: ${list.find((w) => w.isMain)?.label}`);

    const ready = await evalJs(
      client,
      `(() => ({
         hasEditor: !!document.querySelector('.ProseMirror') || !!document.querySelector('.cm-editor'),
         tauriEmit: typeof window?.__TAURI__?.event?.emit === 'function',
         tauriInvoke: typeof window?.__TAURI__?.core?.invoke === 'function',
       }))()`,
      ctx.cfg.timeoutMs
    );
    if (!ready.hasEditor) throw new Error("no editor surface (.ProseMirror / .cm-editor) found");
    if (!ready.tauriEmit) throw new Error("window.__TAURI__.event.emit unavailable");
    if (!ready.tauriInvoke) throw new Error("window.__TAURI__.core.invoke unavailable");

    const tabs = await getTabs(client);
    if (tabs.length === 0) throw new Error("tab bar is empty");
    const active = tabs.filter((t) => t.selected);
    if (active.length !== 1) {
      throw new Error(`expected exactly 1 active tab, saw ${active.length}: ${JSON.stringify(tabs)}`);
    }
    ctx.log(`${tabs.length} tab(s), active: "${active[0].title}"`);
  },
};
