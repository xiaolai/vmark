/**
 * Inline Code Boundary Extension for Tiptap
 *
 * Wraps the ProseMirror plugin that fixes cursor behavior at the
 * left boundary of inline code marks.
 */

import { Extension } from "@tiptap/core";
import { createInlineCodeBoundaryPlugin } from "./plugin";

export const inlineCodeBoundaryExtension = Extension.create({
  name: "inlineCodeBoundary",

  addProseMirrorPlugins() {
    return [createInlineCodeBoundaryPlugin()];
  },
});
