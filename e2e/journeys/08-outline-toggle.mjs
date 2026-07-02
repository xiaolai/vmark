/**
 * Journey: outline-toggle
 *
 * Builds a real heading in a scratch tab (menu:heading-1 through the unified
 * menu dispatcher), toggles the outline sidebar via `menu:outline`
 * (CommandBus view.toggleOutline), asserts the panel appears AND lists the
 * heading, then toggles it back to its initial visibility. Works whether the
 * outline started open or closed — the journey restores whatever it found.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  emitMenu,
  poll,
} from "../lib/vmark.mjs";

const OUTLINE_VISIBLE = `!!document.querySelector('.outline-view')`;

export default {
  name: "outline-toggle",

  async run(client, ctx) {
    const headingText = `Outline Heading ${Date.now()}`;

    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);

      // Make a real h1: type the text, then apply Heading 1 via the menu.
      await typeInActiveEditor(client, headingText, { mustBeEmpty: true });
      await emitMenu(client, "heading-1", ctx.windowLabel);
      await poll(
        () =>
          evalJs(
            client,
            `[...document.querySelectorAll('.ProseMirror h1')].some(el => el.textContent.includes(${JSON.stringify(headingText)}))`
          ),
        (v) => v === true,
        "menu:heading-1 to produce an <h1>"
      );

      const initiallyVisible = await evalJs(client, OUTLINE_VISIBLE);
      ctx.log(`outline initially ${initiallyVisible ? "visible" : "hidden"}`);

      try {
        // Toggle once — visibility must flip.
        await emitMenu(client, "outline", ctx.windowLabel);
        await poll(
          () => evalJs(client, OUTLINE_VISIBLE),
          (v) => v === !initiallyVisible,
          "outline visibility to flip"
        );

        // The heading-list assertion needs the panel VISIBLE. If the outline
        // started visible, the first flip just hid it — toggle back open so
        // the content check always runs (never skipped by initial state).
        if (initiallyVisible) {
          await emitMenu(client, "outline", ctx.windowLabel);
          await poll(
            () => evalJs(client, OUTLINE_VISIBLE),
            (v) => v === true,
            "outline to reopen for the heading assertion"
          );
        }
        await poll(
          () =>
            evalJs(
              client,
              `[...document.querySelectorAll('.outline-view .outline-text')].some(el => el.textContent.includes(${JSON.stringify(headingText)}))`
            ),
          (v) => v === true,
          "outline to list the document heading"
        );
        ctx.log("outline lists the scratch document's heading");
      } finally {
        // Restore the initial visibility no matter what happened above.
        const nowVisible = await evalJs(client, OUTLINE_VISIBLE);
        if (nowVisible !== initiallyVisible) {
          await emitMenu(client, "outline", ctx.windowLabel);
          await poll(
            () => evalJs(client, OUTLINE_VISIBLE),
            (v) => v === initiallyVisible,
            "outline visibility restored"
          );
        }
      }
      ctx.log("outline visibility restored to initial state");
    });
  },
};
