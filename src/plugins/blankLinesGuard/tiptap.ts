/**
 * Blank-lines guard Tiptap extension — registers the ProseMirror plugin that
 * clears blankLinesBefore on edit-created blocks (see blankLinesGuard.ts).
 * Always active and harmless: it only nulls a metadata attribute that is
 * default-null and only emitted when preserveBlankLines is on.
 *
 * @module plugins/blankLinesGuard/tiptap
 */
import { Extension } from "@tiptap/core";
import { blankLinesGuard } from "./blankLinesGuard";

export const blankLinesGuardExtension = Extension.create({
  name: "blankLinesGuard",
  addProseMirrorPlugins() {
    return [blankLinesGuard()];
  },
});
