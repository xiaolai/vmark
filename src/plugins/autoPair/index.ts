/**
 * Auto-Pair Plugin
 *
 * Automatically insert matching closing brackets, quotes, and CJK pairs.
 * Features:
 * - Auto-pair on opening character input
 * - Wrap selection with pairs
 * - Skip over existing closing characters
 * - Delete both chars on backspace when empty pair
 */

import { $prose } from "@milkdown/kit/utils";
import { Plugin, PluginKey } from "@milkdown/kit/prose/state";
import { useSettingsStore } from "@/stores/settingsStore";
import { handleTextInput, createKeyHandler, type AutoPairConfig } from "./handlers";

export const autoPairPluginKey = new PluginKey("autoPair");

/**
 * Get current auto-pair configuration from settings.
 */
function getConfig(): AutoPairConfig {
  const settings = useSettingsStore.getState().markdown;
  return {
    enabled: settings.autoPairEnabled ?? true,
    includeCJK: settings.autoPairCJKStyle !== "off",
    includeCurlyQuotes: settings.autoPairCurlyQuotes ?? false,
  };
}

export const autoPairPlugin = $prose(() => {
  // Track IME composition state
  let isComposing = false;

  return new Plugin({
    key: autoPairPluginKey,

    props: {
      handleTextInput(view, from, to, text) {
        // Skip during IME composition
        if (isComposing) return false;

        const config = getConfig();
        return handleTextInput(view, from, to, text, config);
      },

      handleKeyDown(view, event) {
        // Skip during IME composition
        if (isComposing) return false;

        const config = getConfig();
        const handler = createKeyHandler(config);
        return handler(view, event);
      },

      handleDOMEvents: {
        compositionstart() {
          isComposing = true;
          return false;
        },
        compositionend() {
          isComposing = false;
          return false;
        },
      },
    },
  });
});
