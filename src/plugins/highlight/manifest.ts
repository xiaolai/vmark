/**
 * highlight manifest — ADR-011 with tiptap factory demo.
 */
import type { PluginManifest } from "@/plugins/registry";
import { highlightExtension } from "./tiptap";

export const manifest: PluginManifest = {
  id: "highlight",
  formats: ["markdown"],
  modes: ["wysiwyg"],
  tiptap: () => highlightExtension,
};
