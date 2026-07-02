/**
 * Journey: find-bar
 *
 * Opens the find/replace bar through the real `menu:find-replace` path
 * (useSearchCommands → uiStore.searchOpen), asserts the bar renders with its
 * full control set, then closes it with the same Escape keystroke a user
 * would press. Runs inside a scratch tab; asserts the bar is gone afterwards.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  emitMenu,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "find-bar",

  async run(client, ctx) {
    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);
      await typeInActiveEditor(client, `find bar test ${Date.now()}`, { mustBeEmpty: true });

      try {
        await emitMenu(client, "find-replace", ctx.windowLabel);
        // Stable control classes from src/components/FindBar/FindBar.tsx:
        // 2 .find-bar-input (find + replace), 2 .find-bar-nav-btn (prev/next),
        // 2 .find-bar-icon-btn (replace / replace all), 1 .find-bar-close,
        // 2-3 .find-bar-toggle (case + whole-word always; regex is
        // settings-gated behind enableRegexSearch).
        const bar = await poll(
          () =>
            evalJs(
              client,
              `(() => {
                 const el = document.querySelector('.find-bar');
                 if (!el) return { present: false };
                 return {
                   present: true,
                   inputs: el.querySelectorAll('.find-bar-input').length,
                   toggles: el.querySelectorAll('.find-bar-toggle').length,
                   navBtns: el.querySelectorAll('.find-bar-nav-btn').length,
                   replaceBtns: el.querySelectorAll('.find-bar-icon-btn').length,
                   closeBtn: !!el.querySelector('.find-bar-close'),
                 };
               })()`
            ),
          (v) => v.present,
          "find bar (.find-bar) to open"
        );
        if (
          bar.inputs !== 2 ||
          bar.toggles < 2 ||
          bar.navBtns !== 2 ||
          bar.replaceBtns !== 2 ||
          !bar.closeBtn
        ) {
          throw new Error(`find bar incomplete: ${JSON.stringify(bar)}`);
        }
        ctx.log(
          `find bar open (find+replace inputs, ${bar.toggles} toggles, prev/next, replace actions, close)`
        );

        // Close it the way a user does: Escape inside the bar.
        await evalJs(
          client,
          `(() => {
             const input = document.querySelector('.find-bar input') ?? document.activeElement;
             input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
             return true;
           })()`
        );
        await poll(
          () => evalJs(client, `!!document.querySelector('.find-bar')`),
          (v) => v === false,
          "find bar to close on Escape"
        );
        ctx.log("find bar closed via Escape");
      } finally {
        // Never leak an open find bar, even if an assertion above failed.
        // Use the stable .find-bar-close class — matching localized
        // aria-label text would break under non-English locales.
        const stillOpen = await evalJs(client, `!!document.querySelector('.find-bar')`);
        if (stillOpen) {
          try {
            await evalJs(
              client,
              `(document.querySelector('.find-bar .find-bar-close')?.click(), true)`
            );
            await poll(
              () => evalJs(client, `!!document.querySelector('.find-bar')`),
              (v) => v === false,
              "find bar to close during cleanup"
            );
          } catch (cleanupErr) {
            // Best effort — never mask the primary journey error.
            ctx.log(`find bar cleanup failed: ${cleanupErr?.message ?? cleanupErr}`);
          }
        }
      }
    });
  },
};
