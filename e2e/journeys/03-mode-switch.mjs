/**
 * Journey: mode-switch-preserves-content
 *
 * WYSIWYG → Source → WYSIWYG round trip via the real `menu:source-mode`
 * command path (CommandBus view.toggleSourceMode), asserting the document
 * text survives both serialization directions. Runs entirely inside a
 * scratch tab; teardown always restores WYSIWYG mode.
 */

import { evalJs } from "../lib/bridge.mjs";
import {
  withTabRestore,
  createScratchTab,
  typeInActiveEditor,
  emitMenu,
  getEditorMode,
  ensureWysiwygMode,
  getEditorText,
  poll,
} from "../lib/vmark.mjs";

export default {
  name: "mode-switch-preserves-content",

  async run(client, ctx) {
    const body = `mode switch body ${Date.now()}`;

    await withTabRestore(client, async ({ track }) => {
      const scratch = await createScratchTab(client);
      track(scratch.id);

      try {
        const startMode = await getEditorMode(client);
        if (startMode !== "wysiwyg") throw new Error(`expected WYSIWYG start, got ${startMode}`);

        await typeInActiveEditor(client, body, { mustBeEmpty: true });

        // → Source
        await emitMenu(client, "source-mode", ctx.windowLabel);
        await poll(() => getEditorMode(client), (m) => m === "source", "Source mode (.cm-editor)");
        const sourceText = await poll(
          () => evalJs(client, `document.querySelector('.cm-content')?.textContent ?? ''`),
          (t) => t.includes(body),
          "typed text visible in CodeMirror source"
        );
        ctx.log(`source view shows content (${sourceText.length} chars)`);

        // → back to WYSIWYG
        await emitMenu(client, "source-mode", ctx.windowLabel);
        await poll(() => getEditorMode(client), (m) => m === "wysiwyg", "back to WYSIWYG");
        await poll(
          () => getEditorText(client),
          (t) => typeof t === "string" && t.includes(body),
          "content preserved after mode round-trip"
        );
        ctx.log("content preserved across WYSIWYG → Source → WYSIWYG");
      } finally {
        // Never leave the window stuck in Source mode, even on failure.
        await ensureWysiwygMode(client, ctx.windowLabel);
      }
    });
  },
};
