/**
 * Journey: boot-editor-ready (read-only)
 *
 * Verifies the live app is in a drivable state: the bridge reports a window,
 * the Tauri event channel every other journey uses is live, and the window has
 * completed the ready handshake (`lib/readiness.mjs`). Mutates nothing.
 *
 * It does NOT require an open document. A session is a property of the profile,
 * not of a running app: a fresh profile — which is what a CI runner and a
 * first-launch user both get — shows the welcome screen with no tabs and no
 * editor. This header used to promise "a ProseMirror surface and exactly one
 * active tab", which made the journey a restored-session detector that passed
 * only on a maintainer's machine (audit finding #7).
 *
 * When a tab IS active, the surface it must host depends on the tab's KIND:
 * a media tab renders `.media-view`, not an editor, so demanding
 * `.ProseMirror`/`.cm-editor` failed a perfectly healthy session (audit
 * finding #4). And surfaces mount through `React.lazy`, so the check polls
 * rather than sampling once (audit finding #5).
 */

import { expectSuccess, evalJs } from "../lib/bridge.mjs";
import { DRIVABLE_SNIPPET, drivableGap } from "../lib/readiness.mjs";
import { getTabs, poll } from "../lib/vmark.mjs";

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

    // The same predicate CI's readiness gate waits on — this journey is the
    // definition of "drivable", so it must not carry a second copy of it.
    // See lib/readiness.mjs for why the gate stopped probing `1+1`.
    const gap = drivableGap(await evalJs(client, DRIVABLE_SNIPPET, ctx.cfg.timeoutMs));
    if (gap) throw new Error(`app is not drivable: ${gap}`);

    // Tabs are a property of the SESSION, not of a running app: a fresh profile
    // — which is what a CI runner and a first-launch user both get — shows the
    // welcome screen with none. Asserting "exactly 1 tab" made this journey a
    // restored-session detector that happened to pass on a maintainer's
    // machine. The invariant that holds in BOTH states is the one worth
    // pinning: at most one tab is active, and if any tab is open exactly one
    // is, with an editor mounted for it.
    const tabs = await getTabs(client);
    const active = tabs.filter((t) => t.selected);
    if (active.length > 1) {
      throw new Error(`more than one active tab: ${JSON.stringify(tabs)}`);
    }
    if (tabs.length === 0) {
      // `active` is derived by filtering `tabs`, so it cannot be non-empty
      // here — the guard that used to sit at this line was unreachable
      // (audit finding #6).
      ctx.log("no tabs open — welcome screen; app is drivable");
      return;
    }
    if (active.length !== 1) {
      throw new Error(`${tabs.length} tab(s) open but none active: ${JSON.stringify(tabs)}`);
    }

    // Any ONE of these is a correct surface — which it is depends on the active
    // tab's format, which the tab bar does not report. Requiring an editor
    // specifically failed a healthy media tab.
    //
    // Every selector here is verified against the component that renders it:
    // `.browser-workspace-surface` is `BrowserWorkspaceSurface.tsx`, NOT
    // `.browser-workspace` — that shorter name belongs to no element (the
    // shell root uses `browser-workspace-active`), so the first version of
    // this check could never have matched a browser tab and would have timed
    // out on one.
    const surface = await poll(
      () =>
        evalJs(
          client,
          `(() => {
             if (document.querySelector('.ProseMirror')) return 'wysiwyg';
             if (document.querySelector('.cm-editor')) return 'source';
             if (document.querySelector('.media-view')) return 'media';
             if (document.querySelector('.browser-workspace-surface')) return 'browser';
             return null;
           })()`,
          ctx.cfg.timeoutMs,
        ),
      (kind) => kind !== null,
      `a content surface for active tab "${active[0].title}"`,
    );
    ctx.log(`${tabs.length} tab(s), active: "${active[0].title}" (${surface} surface)`);
  },
};
