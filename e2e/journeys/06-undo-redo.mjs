/**
 * Journey: undo-redo
 *
 * Exercises the unified history system through the real menu path
 * (`menu:undo` / `menu:redo` → performUnifiedUndo/Redo): bold a word in a
 * scratch tab, undo removes the <strong> mark while keeping the text, redo
 * restores it. All inside a scratch tab that is force-discarded afterwards.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  selectTextInEditor,
  emitMenu,
  getEditorText,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "undo-redo",

  async run(client, ctx) {
    const word = `historyword${Date.now()}`;
    const hasStrong = () =>
      evalJs(
        client,
        `[...document.querySelectorAll('.ProseMirror strong')].some(el => el.textContent.includes(${JSON.stringify(word)}))`
      );

    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);

      await typeInActiveEditor(client, `history test: ${word}`, { mustBeEmpty: true });
      await selectTextInEditor(client, word);
      await emitMenu(client, "bold", ctx.windowLabel);
      await poll(hasStrong, (v) => v === true, "bold applied (setup)");

      await emitMenu(client, "undo", ctx.windowLabel);
      await poll(hasStrong, (v) => v === false, "undo removed the <strong> mark");
      const textAfterUndo = await getEditorText(client);
      if (!textAfterUndo?.includes(word)) {
        throw new Error("undo removed the text itself, not just the mark");
      }
      ctx.log("undo reverted formatting, text intact");

      await emitMenu(client, "redo", ctx.windowLabel);
      await poll(hasStrong, (v) => v === true, "redo restored the <strong> mark");
      ctx.log("redo restored formatting");
    });
  },
};
