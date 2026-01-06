import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { useSettingsStore } from "@/stores/settingsStore";
import { handleTextInput, createKeyHandler, type AutoPairConfig } from "./handlers";

const autoPairPluginKey = new PluginKey("autoPair");

function getConfig(): AutoPairConfig {
  const settings = useSettingsStore.getState().markdown;
  return {
    enabled: settings.autoPairEnabled ?? true,
    includeCJK: settings.autoPairCJKStyle !== "off",
    includeCurlyQuotes: settings.autoPairCurlyQuotes ?? false,
  };
}

export const autoPairExtension = Extension.create({
  name: "autoPair",
  addProseMirrorPlugins() {
    let isComposing = false;

    return [
      new Plugin({
        key: autoPairPluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            if (isComposing) return false;
            return handleTextInput(
              view as unknown as Parameters<typeof handleTextInput>[0],
              from,
              to,
              text,
              getConfig()
            );
          },
          handleKeyDown(view, event) {
            if (isComposing) return false;
            const handler = createKeyHandler(getConfig());
            return handler(view as unknown as Parameters<typeof handler>[0], event);
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
      }),
    ];
  },
});
