/**
 * Journey: tab-lifecycle
 *
 * Creates TWO scratch tabs, gives each distinct content, then switches
 * between them asserting (a) the tab bar's active marker follows, and
 * (b) the visible editor shows each tab's own document — i.e. per-tab
 * document isolation across tab switches. Both tabs are then closed and
 * the original tab set restored.
 */

import {
  withTabRestore,
  createScratchTab,
  switchToTab,
  typeInActiveEditor,
  getEditorText,
  getActiveTab,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "tab-lifecycle",

  async run(client, ctx) {
    const stamp = Date.now();
    const alpha = `alpha-content-${stamp}`;
    const beta = `beta-content-${stamp}`;

    await withTabRestore(client, async ({ track }) => {
      const tabA = await createScratchTab(client);
      track(tabA.id);
      await typeInActiveEditor(client, alpha, { mustBeEmpty: true });

      const tabB = await createScratchTab(client);
      track(tabB.id);
      await typeInActiveEditor(client, beta, { mustBeEmpty: true });
      ctx.log(`created ${tabA.id} (alpha) and ${tabB.id} (beta)`);

      // Switch back to A: active marker moves, editor shows alpha only.
      await switchToTab(client, tabA.id);
      const activeA = await getActiveTab(client);
      if (activeA?.id !== tabA.id) throw new Error("tab A did not become active");
      await poll(
        () => getEditorText(client),
        (t) => typeof t === "string" && t.includes(alpha) && !t.includes(beta),
        "editor shows tab A's document after switch"
      );

      // And forward to B again.
      await switchToTab(client, tabB.id);
      await poll(
        () => getEditorText(client),
        (t) => typeof t === "string" && t.includes(beta) && !t.includes(alpha),
        "editor shows tab B's document after switch"
      );
      ctx.log("per-tab document isolation verified across switches");
    });
  },
};
