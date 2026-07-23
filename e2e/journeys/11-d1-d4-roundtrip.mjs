/**
 * Journey: d1-d4-roundtrip-preserved
 *
 * End-to-end confirmation that the extension re-architecture's four documented
 * round-trip fixes (D1-D4) hold in the LIVE app — through the real production
 * schema and the actual WYSIWYG → markdown serializer (the `menu:source-mode`
 * path), not just the jsdom unit/property tests.
 *
 *   D1 — block media alt text is preserved   (was dropped: `![](clip.mp4)`)
 *   D2 — link titles are preserved           (was dropped: `[t](url)`)
 *   D3 — highlight (incl. nested mark) is not escaped (`==x==`, not `\==x==`)
 *   D4 — escaped superscript markers stay escaped (`x\^2\^`, not `x^2^`)
 *
 * Content is established via setEditorContent (the app's synchronous
 * `vmark.document.write` path) because DOM typing does not flush to the store
 * when the automated window is backgrounded — see e2e/lib/vmark.mjs. Runs inside
 * a scratch tab; teardown always restores WYSIWYG mode and the tab bar.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  setEditorContent,
  emitMenu,
  getEditorMode,
  ensureWysiwygMode,
  poll,
} from "../lib/vmark.mjs";

const D1_D4_MARKDOWN =
  '![A short clip](clip.mp4)\n\n' +
  'A [titled link](https://example.com "Title") and ' +
  '==highlight with **bold**== plus escaped x\\^2\\^ markers.\n';

export default {
  name: "d1-d4-roundtrip-preserved",

  async run(client, ctx) {
    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);

      try {
        // Establish the D1-D4 constructs in the WYSIWYG editor (parsed).
        await setEditorContent(client, D1_D4_MARKDOWN, { mustBeEmpty: true });

        // → Source: serialize WYSIWYG → markdown via the real menu path.
        await emitMenu(client, "source-mode", ctx.windowLabel);
        await poll(() => getEditorMode(client), (m) => m === "source", "Source mode (.cm-editor)");
        const src = await poll(
          () => evalJs(client, `document.querySelector('.cm-content')?.textContent ?? ''`),
          (t) => t.length > 0,
          "serialized markdown visible in CodeMirror source"
        );

        const checks = {
          "D1 media alt": src.includes("![A short clip](clip.mp4)"),
          "D2 link title": src.includes('"Title"'),
          "D3 highlight not escaped": src.includes("==highlight with **bold**==") && !src.includes("\\=="),
          "D4 escaped caret preserved": src.includes("x\\^2\\^") && !src.includes("x^2^"),
        };
        const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
        if (failed.length > 0) {
          throw new Error(
            `D1-D4 round-trip corrupted in Source mode: [${failed.join(", ")}]\n` +
              `  serialized: ${src.replace(/\s+/g, " ").slice(0, 160)}`
          );
        }
        ctx.log("D1-D4 all preserved through the live WYSIWYG → Source round-trip");
      } finally {
        // Never leave the window stuck in Source mode, even on failure.
        await ensureWysiwygMode(client, ctx.windowLabel);
      }
    });
  },
};
