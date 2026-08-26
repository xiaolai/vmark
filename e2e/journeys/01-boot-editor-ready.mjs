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
 * Both kinds of tab count. The synthetic browser-workspace tab is a `role="tab"`
 * with no `data-tab-id`, so the document-tab reading alone could not see it —
 * see `getWorkspaceTab` in lib/vmark.mjs.
 *
 * When a tab IS active, the surface it must host depends on the tab's KIND:
 * a media tab renders `.media-view`, not an editor, so demanding
 * `.ProseMirror`/`.cm-editor` failed a perfectly healthy session (audit
 * finding #4). And surfaces mount through `React.lazy`, so the check polls
 * rather than sampling once (audit finding #5).
 */

import { evalJs, listWindows } from "../lib/bridge.mjs";
import { DRIVABLE_SNIPPET, drivableGap } from "../lib/readiness.mjs";
import { getTabs, getWorkspaceTab, poll } from "../lib/vmark.mjs";

/**
 * The one tab that is active, across both kinds — or null when the session has
 * none. Throws if the strip somehow reports two.
 *
 * The strip has TWO kinds of tab, and the browser one is not a document: it
 * carries no `data-tab-id`, and when it is selected every document tab reads
 * `aria-selected="false"`. Reading only documents therefore called a healthy
 * browser-active session "tabs open but none active" — a false failure — and
 * called a browser-only session an empty welcome screen — a false pass that
 * skipped the surface check entirely (audit finding #51).
 */
async function activeTab(client) {
  const tabs = await getTabs(client);
  const workspaceTab = await getWorkspaceTab(client);
  const active = [
    ...tabs.filter((t) => t.selected),
    ...(workspaceTab?.selected ? [workspaceTab] : []),
  ];
  const state = { tabs, workspaceTab };

  if (active.length > 1) {
    throw new Error(`more than one active tab: ${JSON.stringify(state)}`);
  }
  if (tabs.length === 0 && !workspaceTab) return { ...state, active: null };
  if (active.length !== 1) {
    throw new Error(
      `${tabs.length} document tab(s) open but none active: ${JSON.stringify(state)}`,
    );
  }
  return { ...state, active: active[0] };
}

/**
 * Wait for a content surface and name it.
 *
 * Any ONE of these is correct — which it is depends on the active tab's format,
 * which the tab bar does not report, so requiring an editor specifically failed
 * a healthy media tab. Surfaces mount through `React.lazy`, hence the poll.
 *
 * Every selector is verified against the component that renders it:
 * `.browser-workspace-surface` is `BrowserWorkspaceSurface.tsx`, NOT
 * `.browser-workspace` — that shorter name belongs to no element (the shell
 * root uses `browser-workspace-active`), so the first version of this check
 * could never have matched a browser tab and would have timed out on one.
 * `src/components/StatusBar/tabStripHarnessContract.test.tsx` pins that.
 */
function contentSurface(client, timeoutMs, label) {
  return poll(
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
        timeoutMs,
      ),
    (kind) => kind !== null,
    `a content surface for active tab "${label}"`,
  );
}

export default {
  name: "boot-editor-ready",

  async run(client, ctx) {
    const list = await listWindows(client, ctx.cfg.timeoutMs);
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
    // is, with a content surface mounted for it.
    const { tabs, workspaceTab, active } = await activeTab(client);
    if (!active) {
      ctx.log("no tabs open — welcome screen; app is drivable");
      return;
    }

    const surface = await contentSurface(client, ctx.cfg.timeoutMs, active.title);
    // The browser workspace has exactly one correct surface, so when it is the
    // active tab that is an assertion rather than a menu of options.
    if (active.kind === "workspace" && surface !== "browser") {
      throw new Error(`browser workspace is active but the surface is "${surface}"`);
    }
    ctx.log(
      `${tabs.length} document tab(s)${workspaceTab ? " + browser workspace" : ""}, ` +
        `active: "${active.title}" (${surface} surface)`,
    );
  },
};
