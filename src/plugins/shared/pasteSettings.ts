/**
 * Purpose: the paste-behaviour vocabulary the paste plugins accept.
 *
 * Declared HERE rather than imported from the app's settings types. A plugin
 * that depends on the app's type module still cannot be lifted out of this
 * repo, so the coupling gate counts a type-only import too — and it is right
 * to: the plugin should state the shape it needs and let the host map its
 * settings onto that, which is what dependency inversion means.
 *
 * The union is structurally identical to the store's `PasteMode` today. That
 * is not duplication to be eliminated — it is the boundary. If the two ever
 * diverge, the host's mapping is where the difference gets resolved, and it
 * will fail to compile rather than silently mistranslate.
 *
 * @coordinates-with plugins/codePaste/tiptap.ts, plugins/htmlPaste/tiptap.ts
 * @coordinates-with services/assembly/pasteOptions.ts — the host mapping
 * @module plugins/shared/pasteSettings
 */

/** How a paste should be interpreted. */
export type PasteMode = "smart" | "plain" | "rich";

/** Everything the paste plugins need to know, read fresh per paste. */
export interface PasteSettings {
  pasteMode: PasteMode;
  preserveLineBreaks: boolean;
}

/** Smart paste, breaks not preserved — sane behaviour with no settings layer. */
export const DEFAULT_PASTE_SETTINGS: PasteSettings = {
  pasteMode: "smart",
  preserveLineBreaks: false,
};
