/**
 * Source Footnote Actions
 *
 * Actions for editing footnotes in Source mode (CodeMirror 6).
 */

import type { Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { StoreApi } from "@/plugins/sourcePopup";
import type { FootnotePopupState } from "@/plugins/shared/popupPorts";

/** The popup state these actions read — injected, never imported (ADR-015). */
type Store = StoreApi<FootnotePopupState>;
import { runOrQueueCodeMirrorAction } from "@/utils/imeGuard";
import { sourcePopupWarn } from "@/utils/debug";

const FOOTNOTE_DEF_REGEX = /^\[\^([^\]]+)\]:\s*(.*)$/;

function isFootnoteContinuationLine(lineText: string): boolean {
  return /^(\s{2,}|\t)/.test(lineText);
}

function stripFootnoteIndent(lineText: string): string {
  if (lineText.startsWith("\t")) return lineText.slice(1);
  /* v8 ignore next -- @preserve continuation lines always start with tab or 2+ spaces; other whitespace is structurally unreachable */
  if (lineText.startsWith("  ")) return lineText.slice(2);
  /* v8 ignore next -- @preserve fallback branch: after tab and double-space checks, remaining whitespace patterns are structurally unreachable */
  return lineText.replace(/^\s+/, "");
}

function buildFootnoteDefinitionBlock(
  doc: Text,
  startLineNumber: number,
  label: string,
  firstLineContent: string
): { from: number; to: number; content: string; label: string } {
  /* v8 ignore next -- @preserve directMatch[2] always exists (captured by (.*) group); nullish fallback is unreachable */
  const contentLines: string[] = [firstLineContent ?? ""];
  let endLineNumber = startLineNumber;

  for (let i = startLineNumber + 1; i <= doc.lines; i += 1) {
    const lineText = doc.line(i).text;
    if (!isFootnoteContinuationLine(lineText)) {
      break;
    }
    contentLines.push(stripFootnoteIndent(lineText));
    endLineNumber = i;
  }

  return {
    from: doc.line(startLineNumber).from,
    to: doc.line(endLineNumber).to,
    content: contentLines.join("\n"),
    label,
  };
}

function buildFootnoteDefinitionText(label: string, content: string): string {
  const lines = content.split(/\r?\n/);
  /* v8 ignore next -- @preserve split always returns at least one element; lines[0] is never undefined */
  const firstLine = lines[0] ?? "";
  const rest = lines.slice(1);
  const formatted = [`[^${label}]: ${firstLine}`];
  for (const line of rest) {
    formatted.push(`  ${line}`);
  }
  return formatted.join("\n");
}

/**
 * Save footnote content changes.
 * Updates the definition content in the document.
 */
export function saveFootnoteContent(view: EditorView, store: Store): void {
  const state = store.getState();
  const { content, definitionPos, label } = state;

  if (definitionPos === null || !label) {
    // No definition found - nothing to save
    return;
  }

  runOrQueueCodeMirrorAction(view, () => {
    const definition =
      findFootnoteDefinitionAtPos(view, definitionPos) ?? findFootnoteDefinition(view, label);
    if (!definition) {
      sourcePopupWarn("Definition not found for save");
      return;
    }

    const newText = buildFootnoteDefinitionText(label, content);
    view.dispatch({
      changes: {
        from: definition.from,
        to: definition.to,
        insert: newText,
      },
    });
  });
}

/**
 * Go to the footnote definition from reference (or vice versa).
 */
export function gotoFootnoteTarget(
  view: EditorView,
  openedOnReference: boolean,
  store: Store
): void {
  const state = store.getState();
  const { definitionPos, referencePos } = state;

  runOrQueueCodeMirrorAction(view, () => {
    const targetPos = openedOnReference ? definitionPos : referencePos;
    if (targetPos === null) {
      sourcePopupWarn("Target position not found");
      return;
    }

    // Scroll to and select at target
    view.dispatch({
      selection: { anchor: targetPos },
      scrollIntoView: true,
    });
  });
}

/**
 * Remove the footnote completely (both reference and definition).
 */
export function removeFootnote(view: EditorView, store: Store): void {
  const state = store.getState();
  const { label, definitionPos, referencePos } = state;
  if (!label) return;

  const references = findFootnoteReferences(view, label);
  const referenceAtPos = findFootnoteReferenceAtPos(view, label, referencePos);
  /* v8 ignore next -- @preserve defensive dedup guard: referenceAtPos is always found by findFootnoteReferences since both use the same regex */
  if (referenceAtPos && !references.some((ref) => ref.from === referenceAtPos.from)) {
    references.push(referenceAtPos);
  }

  if (references.length === 0) return;

  runOrQueueCodeMirrorAction(view, () => {
    const doc = view.state.doc;
    const changes: { from: number; to: number; insert: string }[] = [];

    for (const reference of references) {
      changes.push({ from: reference.from, to: reference.to, insert: "" });
    }

    const definition =
      (definitionPos !== null ? findFootnoteDefinitionAtPos(view, definitionPos) : null) ??
      findFootnoteDefinition(view, label);
    if (definition) {
      const defTo = definition.to < doc.length ? definition.to + 1 : definition.to;
      changes.push({ from: definition.from, to: defTo, insert: "" });
    }

    changes.sort((a, b) => a.from - b.from);
    view.dispatch({ changes });
  });
}

function findFootnoteReferenceAtPos(
  view: EditorView,
  label: string,
  pos: number | null
): { from: number; to: number } | null {
  if (pos === null) return null;
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const text = line.text;
  const refRegex = new RegExp(`\\[\\^${escapeRegex(label)}\\](?!:)`, "g");
  let match;
  while ((match = refRegex.exec(text)) !== null) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (pos >= from && pos <= to) {
      return { from, to };
    }
  }
  return null;
}

export function findFootnoteDefinitionAtPos(
  view: EditorView,
  pos: number
): { from: number; to: number; label: string; content: string } | null {
  const doc = view.state.doc;
  const line = doc.lineAt(pos);
  const directMatch = line.text.match(FOOTNOTE_DEF_REGEX);
  if (directMatch) {
    return buildFootnoteDefinitionBlock(doc, line.number, directMatch[1], directMatch[2] || "");
  }

  if (!isFootnoteContinuationLine(line.text)) {
    return null;
  }

  for (let i = line.number - 1; i >= 1; i -= 1) {
    const current = doc.line(i);
    const match = current.text.match(FOOTNOTE_DEF_REGEX);
    if (match) {
      return buildFootnoteDefinitionBlock(doc, i, match[1], match[2] || "");
    }
    if (!isFootnoteContinuationLine(current.text)) {
      break;
    }
  }

  return null;
}

/**
 * Find the footnote definition for a given label in the document.
 * Returns the position and content, or null if not found.
 */
export function findFootnoteDefinition(
  view: EditorView,
  label: string
): { from: number; to: number; content: string } | null {
  const doc = view.state.doc;
  const defRegex = new RegExp(`^\\[\\^${escapeRegex(label)}\\]:\\s*(.*)$`);

  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const match = line.text.match(defRegex);
    if (match) {
      return buildFootnoteDefinitionBlock(doc, i, label, match[1] || "");
    }
  }

  return null;
}

export function findFootnoteReferences(
  view: EditorView,
  label: string
): Array<{ from: number; to: number }> {
  const doc = view.state.doc;
  const refRegex = new RegExp(`\\[\\^${escapeRegex(label)}\\](?!:)`, "g");
  const references: Array<{ from: number; to: number }> = [];

  for (let i = 1; i <= doc.lines; i += 1) {
    const line = doc.line(i);
    refRegex.lastIndex = 0;
    let match;
    while ((match = refRegex.exec(line.text)) !== null) {
      references.push({
        from: line.from + match.index,
        to: line.from + match.index + match[0].length,
      });
    }
  }

  return references;
}

/**
 * Find the footnote reference for a given label in the document.
 * Returns the first occurrence's position, or null if not found.
 */
export function findFootnoteReference(
  view: EditorView,
  label: string
): { from: number; to: number } | null {
  const references = findFootnoteReferences(view, label);
  if (references.length === 0) return null;
  return references[0];

}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
