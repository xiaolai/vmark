/**
 * underline manifest — ADR-011 with tiptap factory demo.
 */
import type { PluginManifest } from "@/plugins/registry";
import { underlineExtension } from "./tiptap";

export const manifest: PluginManifest = {
  id: "underline",
  formats: ["markdown"],
  modes: ["wysiwyg"],
  tiptap: () => underlineExtension,
};
