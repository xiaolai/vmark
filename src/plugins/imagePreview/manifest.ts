/**
 * imagePreview manifest — ADR-011 foundation entry.
 * Refine modes/slots/commands/dependsOn as the plugin gets characterized.
 */
import type { PluginManifest } from "@/plugins/registry";

export const manifest: PluginManifest = {
  id: "imagePreview",
  formats: ["markdown"],
  modes: ["wysiwyg"],
};
