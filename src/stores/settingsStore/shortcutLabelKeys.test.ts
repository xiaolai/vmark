// @vitest-environment node
/**
 * Every shortcut row in the Shortcuts pane has a locale key for its label and,
 * when it carries one, its description.
 *
 * `settingsShortcutLabels.ts` falls back to the registry's hardcoded English
 * when a key is missing, so a shortcut added without its keys shows English in
 * all ten locales and nothing else notices. `pnpm lint:i18n` then checks the
 * other nine locales carry (translated) copies of these English keys.
 */
import { describe, expect, it } from "vitest";
import en from "@/locales/en/settings.json";
import { DEFAULT_SHORTCUTS } from "./shortcutDefinitions";

const keys = new Set(Object.keys(en));

describe("shortcut locale keys", () => {
  it("every shortcut id has a shortcuts.label key", () => {
    const missing = DEFAULT_SHORTCUTS.filter((s) => !keys.has(`shortcuts.label.${s.id}`)).map(
      (s) => s.id,
    );
    expect(missing).toEqual([]);
  });

  it("every shortcut with a description has a shortcuts.description key", () => {
    const missing = DEFAULT_SHORTCUTS.filter(
      (s) => s.description && !keys.has(`shortcuts.description.${s.id}`),
    ).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});
