/**
 * Purpose: Tiptap wrapper around the inactive-selection ProseMirror plugin.
 *   Imports the shared CSS so consumers don't need to remember to.
 *
 * @coordinates-with utils/tiptapExtensions.ts — registers this extension
 * @module plugins/inactiveSelection/tiptap
 */
import { Extension } from "@tiptap/core";
import { inactiveSelectionPlugin } from "./inactiveSelectionPlugin";
import "./inactive-selection.css";

export const inactiveSelectionExtension = Extension.create({
  name: "inactiveSelection",

  addProseMirrorPlugins() {
    return [inactiveSelectionPlugin()];
  },
});
