/**
 * Spell Check Plugin
 *
 * Provides spell checking with multilingual support.
 * Uses nspell with Hunspell dictionaries.
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { spellCheckPlugin, spellCheckPluginKey } from "./spellCheckPlugin";
import { SpellCheckPopupView } from "./SpellCheckPopupView";

// Plugin key for the popup view
const spellCheckPopupKey = new PluginKey("spellCheckPopup");

/**
 * Plugin that manages the spell check popup view.
 */
const spellCheckPopupPlugin = $prose(() => {
  return new Plugin({
    key: spellCheckPopupKey,
    view(editorView) {
      const popupView = new SpellCheckPopupView(editorView);
      return {
        destroy() {
          popupView.destroy();
        },
      };
    },
  });
});

// Export as array following Milkdown convention
export const spellCheck = [spellCheckPlugin, spellCheckPopupPlugin];

// Re-export for direct access
export { spellCheckPluginKey };
export type { SpellCheckLanguage, NSpellInstance } from "./types";
