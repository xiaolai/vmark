/**
 * File-name display formatting.
 *
 * Purpose: one place that decides whether a file's extension is shown to the
 * user, so the sidebar tree and the tab strip cannot disagree.
 *
 * Key decisions:
 *   - Only a REGISTERED extension is ever hidden. Hiding ".vue" would show a
 *     name that does not exist on disk for a file VMark cannot even open —
 *     the confusion behind #1224, where `requirements.txt` read as a
 *     mysterious extensionless `requirements`.
 *   - Names are the only input: no store, no settings lookup. Callers pass the
 *     current preference, which keeps this a leaf-pure util (ADR-013).
 *
 * @coordinates-with utils/dropPaths.ts — the registered-extension list
 * @module utils/displayFileName
 */
import { stripSupportedExtension } from "./dropPaths";

/**
 * The name to show for `name`, hiding its extension when `showExtensions` is
 * false and the extension is one VMark recognises.
 */
export function formatFileDisplayName(name: string, showExtensions: boolean): string {
  return showExtensions ? name : stripSupportedExtension(name);
}
