/**
 * What a newly inserted block CONTAINS — one decision, both surfaces.
 *
 * Purpose: the two toolbar adapters build the same block from different
 * substrates (WYSIWYG constructs ProseMirror nodes, Source writes markdown
 * text). That is fine. What is not fine is each one also inventing the block's
 * CONTENT independently, which is what happened: "Insert Table" gave you an
 * empty 2x2 grid in one mode and `Header 1` / `Cell 1` placeholders in the
 * other, and "Insert Details" gave you `<details open>` + a translated summary
 * in one and `<details>` + the hardcoded English word "Details" in the other.
 *
 * Content is a product decision. It belongs here, once, and each surface renders
 * it in its own idiom.
 *
 * Key decisions:
 *   - Table cells are EMPTY. Placeholder text is content the user did not ask
 *     for and has to delete; unnoticed, `Header 1` ships in a real document. The
 *     delimiter row already shows the shape in source mode.
 *   - The markdown renderer DERIVES from `NEW_TABLE` rather than restating it,
 *     so the two spellings of the same table cannot drift apart again.
 *   - The details summary is translated. Source hardcoding English here was an
 *     i18n violation, not merely a parity difference.
 *   - A new details block starts OPEN — inserting one collapsed hides the
 *     content area you were about to type into.
 *
 * @coordinates-with wysiwygAdapterTables.ts — builds the table as PM nodes
 * @coordinates-with sourceInsertActions.ts — writes the table as markdown
 * @coordinates-with sourceContextDetection/sourceInsertions.ts — details builder
 * @module plugins/shared/blockTemplates
 */
import i18n from "@/i18n";

/**
 * Shape of a freshly inserted table.
 *
 * `rows` is the TOTAL row count including the header, which is Tiptap's
 * `insertTable` semantics — the markdown renderer below matches it rather than
 * the other way round, so the two surfaces cannot describe different tables.
 */
export const NEW_TABLE = { rows: 2, cols: 2, withHeaderRow: true } as const;

/** A freshly inserted `<details>` starts expanded. */
export const NEW_DETAILS_OPEN = true;

/**
 * `NEW_TABLE` rendered as markdown, for the surface that writes text.
 *
 * Derived, not restated: changing `NEW_TABLE.cols` changes this output, so the
 * PM-node table and the markdown table stay the same table by construction.
 */
export function newTableMarkdown(): string {
  const row = (cell: string): string => `|${` ${cell} |`.repeat(NEW_TABLE.cols)}`;
  return [
    row(""), // header
    `|${" --- |".repeat(NEW_TABLE.cols)}`,
    ...Array.from({ length: NEW_TABLE.rows - 1 }, () => row("")),
  ].join("\n").concat("\n");
}

/** Summary text for a freshly inserted details block, in the user's language. */
export function newDetailsSummary(): string {
  return i18n.t("editor:plugin.detailsDefaultSummary");
}

/**
 * A details block as markdown, optionally wrapping a selection.
 *
 * The blank line after the summary is required: without it the body is parsed as
 * raw HTML rather than markdown.
 */
export function newDetailsMarkdown(selection: string): string {
  return `${detailsPrefix()}${selection}\n</details>`;
}

/** Caret offset that lands inside the details body, after the summary line. */
export function newDetailsCursorOffset(): number {
  return detailsPrefix().length;
}

/**
 * Everything before the body: opening tag, summary line, and the blank line.
 *
 * Built once and shared, because the offset and the text MUST agree. Spelling
 * the same prefix out twice meant a template edit in one of them would move the
 * caret to the wrong place with nothing to catch it.
 */
function detailsPrefix(): string {
  const open = NEW_DETAILS_OPEN ? "<details open>" : "<details>";
  return `${open}\n<summary>${newDetailsSummary()}</summary>\n\n`;
}
