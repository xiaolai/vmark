/**
 * Journey: scratch-tab-roundtrip
 *
 * The suite's core safety pattern, exercised end-to-end:
 *   create a fresh untitled tab → type a unique marker (only allowed because
 *   the editor is verifiably empty) → the marker round-trips through the real
 *   editor → the dirty dot appears on the scratch tab ONLY → a non-forced
 *   close is REFUSED while dirty (the app's dirty-guard) → a forced close
 *   discards the journey's own content → original tab state restored exactly.
 */

import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  getEditorText,
  getTabs,
  mcpFire,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "scratch-tab-roundtrip",

  async run(client, ctx) {
    const marker = `e2e-roundtrip-${Date.now()}`;

    await withTabRestore(client, async ({ before, track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);
      ctx.log(`scratch tab ${scratch.id} ("${scratch.title}")`);

      await typeInActiveEditor(client, marker, { mustBeEmpty: true });
      const text = await poll(
        () => getEditorText(client),
        (t) => typeof t === "string" && t.includes(marker),
        "typed marker to round-trip through the editor"
      );
      ctx.log(`editor content round-tripped (${text.length} chars)`);

      // Dirty dot must appear on the scratch tab and ONLY the scratch tab.
      const tabs = await poll(
        () => getTabs(client),
        (ts) => ts.find((t) => t.id === scratch.id)?.dirty === true,
        "dirty indicator on scratch tab"
      );
      const newlyDirty = tabs.filter(
        (t) => t.id !== scratch.id && t.dirty && !before.find((b) => b.id === t.id)?.dirty
      );
      if (newlyDirty.length > 0) {
        throw new Error(`other tabs became dirty: ${JSON.stringify(newlyDirty)}`);
      }

      // A non-forced close must be refused while the tab is dirty
      // (vmark.workspace.close replies {closed:false, reason:"DIRTY"} and
      // shows no dialog). Observe: the tab is still present afterwards.
      await mcpFire(client, "vmark.workspace.close", { tabId: scratch.id, force: false });
      const deadline = Date.now() + 900;
      while (Date.now() < deadline) {
        const now = await getTabs(client);
        if (!now.some((t) => t.id === scratch.id)) {
          throw new Error("dirty tab was closed WITHOUT force — dirty-guard regression");
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      ctx.log("non-forced close correctly refused while dirty");
      // Forced discard + exact restoration are handled/verified by withTabRestore.
    });
  },
};
