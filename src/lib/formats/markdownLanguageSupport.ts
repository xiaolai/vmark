/**
 * The ONE CodeMirror Markdown language configuration.
 *
 * Purpose: keep the editor's parser and the document's parser describing the
 * same language. `markdownPipeline` loads `remark-gfm` unconditionally —
 * "Always (tables, task lists, strikethrough, autolinks)" — while every
 * CodeMirror call site used bare `markdown({ codeLanguages })`, whose base is
 * strict CommonMark. So VMark parsed a GFM document with a CommonMark editor.
 *
 * That is not theoretical. Measured on the installed parser, the two bases see
 * completely different documents:
 *
 *   CommonMark (previous):  BulletList, Document, Link, LinkMark, ListItem,
 *                           ListMark, Paragraph
 *   GFM (this module):      …plus Table, TableCell, TableDelimiter, TableHeader,
 *                           TableRow, Task, TaskMarker, Strikethrough,
 *                           StrikethroughMark, Subscript, Superscript, URL
 *
 * A GFM table was not a `Table` to the editor; a task item was not a `Task`; an
 * autolink was not a `URL`. Source-mode highlighting for all of those was
 * missing, and any structural work built on `syntaxTree` would have been blind
 * to them in exactly the constructs VMark supports.
 *
 * `markdownLanguage` is GFM plus subscript/superscript, which matches VMark's
 * own toolbar (`superscript`/`subscript` are actions) rather than exceeding it.
 *
 * Key decisions:
 *   - ONE factory, because three call sites had independently written the same
 *     wrong configuration and would have drifted again.
 *   - `codeLanguages` stays a parameter: the peek editor and the main editor
 *     supply their own language lists.
 *
 * @coordinates-with utils/markdownPipeline/parser/processorFactory.ts — remark-gfm, the document side
 * @coordinates-with services/assembly/sourceEditorExtensions.ts — main source editor
 * @coordinates-with lib/formats/adapters/markdown.tsx — the format adapter
 * @coordinates-with plugins/sourcePeekInline/sourcePeekEditor.ts — inline peek editor
 * @module lib/formats/markdownLanguageSupport
 */
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { LanguageDescription, LanguageSupport } from "@codemirror/language";

/**
 * Markdown language support configured for GFM, matching the document parser.
 *
 * Never call `markdown()` directly — without `base` it silently falls back to
 * strict CommonMark and the editor stops agreeing with the document.
 */
export function markdownLanguageSupport(
  codeLanguages: readonly LanguageDescription[],
): LanguageSupport {
  return markdown({ base: markdownLanguage, codeLanguages: [...codeLanguages] });
}
