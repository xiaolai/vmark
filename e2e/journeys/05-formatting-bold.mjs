/**
 * Journey: formatting-bold
 *
 * Drives the real menu formatting pipeline (`menu:bold` →
 * useUnifiedMenuCommands → wysiwygAdapter) on a selection inside a scratch
 * tab, asserts a <strong> node renders, then flips to Source mode to assert
 * the markdown serialization (`**word**`) — covering the live click/menu
 * formatting path that jsdom tests cannot reach.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  selectTextInEditor,
  emitMenu,
  getEditorMode,
  ensureWysiwygMode,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "formatting-bold",

  async run(client, ctx) {
    const word = `boldword${Date.now()}`;

    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);

      try {
        await typeInActiveEditor(client, `emphasis test: ${word}`, { mustBeEmpty: true });
        await selectTextInEditor(client, word);
        await emitMenu(client, "bold", ctx.windowLabel);

        await poll(
          () =>
            evalJs(
              client,
              `[...document.querySelectorAll('.ProseMirror strong')].some(el => el.textContent.includes(${JSON.stringify(word)}))`
            ),
          (v) => v === true,
          "<strong> node containing the selected word"
        );
        ctx.log("menu:bold produced a rendered <strong> node");

        // Serialization check: the Source view must show **word**.
        await emitMenu(client, "source-mode", ctx.windowLabel);
        await poll(() => getEditorMode(client), (m) => m === "source", "Source mode");
        await poll(
          () => evalJs(client, `document.querySelector('.cm-content')?.textContent ?? ''`),
          (t) => t.includes(`**${word}**`),
          "markdown serialization **word** in source view"
        );
        ctx.log("markdown serialization verified (**word**)");
      } finally {
        await ensureWysiwygMode(client, ctx.windowLabel);
      }
    });
  },
};
