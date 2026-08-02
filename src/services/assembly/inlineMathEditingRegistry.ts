/**
 * Purpose: the one inline-math editing registry the app shares across editors.
 *
 * The latex plugin defaults to a registry created per extension instance,
 * which is the right default for a standalone plugin. The app deliberately
 * overrides it with a single shared instance, because that is the semantics
 * VMark shipped: opening inline math anywhere force-exits whichever math
 * editor was already open. Leaving each editor its own registry would be a
 * silent behaviour change, not a refactor.
 *
 * Export extensions (`createExportExtensions.ts`) do NOT get this one — export
 * never edits, so its own throwaway default is correct there.
 *
 * @coordinates-with plugins/latex/inlineMathEditingRegistry.ts — the interface
 * @coordinates-with services/assembly/tiptapExtensions.ts — where it is passed
 * @module services/assembly/inlineMathEditingRegistry
 */

import { createInlineMathEditingRegistry } from "@/plugins/latex/inlineMathEditingRegistry";

export const appInlineMathEditingRegistry = createInlineMathEditingRegistry();
