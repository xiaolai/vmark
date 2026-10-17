/**
 * pandocFormats — the formats VMark can export through Pandoc, kept apart
 * from the exporter so the menu can list them without loading it.
 *
 * Key decisions:
 *   - A leaf with no imports. The menu mount registers one command per format
 *     before it binds a single listener, and the window's readiness waits on
 *     that mount. Reading this list from `pandocExport.ts` meant importing the
 *     exporter chunk first, so a slow chunk delayed every menu listener.
 *
 * @coordinates-with export/pandocExport.ts — names each format and its file extension
 * @coordinates-with services/commands/exportCommands.ts — registers one command per format
 * @module export/pandocFormats
 */

/** Every Pandoc export format, in menu order. */
export const PANDOC_FORMAT_KEYS = ["docx", "epub", "latex", "odt", "rtf", "txt"] as const;

/** One Pandoc export format key. */
export type PandocFormatKey = (typeof PANDOC_FORMAT_KEYS)[number];
