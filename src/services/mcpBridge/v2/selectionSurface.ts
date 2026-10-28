/**
 * Purpose: the focused editor's selection behind ONE shape, whichever editor
 * is showing the tab — so `selection.get` and `selection.set` are each one
 * algorithm instead of a WYSIWYG branch and a Source branch that have to be
 * kept in step by hand.
 *
 * Key decisions:
 *   - The two modes differ in exactly four things, and those are the
 *     adapter: the selection's range (ProseMirror positions vs character
 *     offsets), the selected text (the Markdown serialization of the slice
 *     vs the raw characters), the document text, and how a replacement is
 *     applied. Everything else — revision check, store mirror, checkpoint,
 *     reply — is the handler's and is written once.
 *   - Text is read from the LIVE editor, not the document store. The store
 *     trails the editor by a debounced flush, so reading it would snapshot
 *     stale content into the checkpoint.
 *   - In WYSIWYG the selected text is the Markdown serialization of the
 *     slice — the same representation `document.read` uses — and a
 *     replacement is parsed as Markdown unless it is plain inline text.
 *   - The editor must belong to the focused tab. An editor still registered
 *     for a previously focused tab is treated as absent: acting on it would
 *     edit a document the request did not name. The surface is whichever
 *     editor is registered for the tab, not what the window's `sourceMode`
 *     says: a YAML SourcePane and a split's source pane register a source
 *     view while `sourceMode` is false.
 *   - `wouldChange` proves a no-op without dispatching anything. Source
 *     compares the text CodeMirror would insert (its line breaks: CRLF and
 *     CR become LF) with the selected characters exactly; that same text is
 *     what `replaceSelection` measures the caret by and what `exactChange`
 *     certifies, so a line-ending-only replacement changes nothing.
 *     WYSIWYG builds the very transaction `replaceSelection` would dispatch
 *     and compares its document with the editor's, node for node, marks and
 *     attributes included: equal selected Markdown is not enough, since the
 *     Markdown may not carry a mark (`++underline++` comes back as literal
 *     text) and a block-spanning slice re-inserted splits its paragraphs.
 *   - `captureApply` runs an apply and returns what the WYSIWYG provenance
 *     collector saw of its flushes (the window its commit certificate is
 *     built from); Source has nothing to capture, its change is exact
 *     (`exactChange`).
 *   - While an IME composition is in progress in the editor (or has just
 *     ended and is not yet cleaned up), `writeRefusal` answers BUSY and
 *     `replaceSelection` throws: a replacement dispatched under the preedit
 *     text is committed or dropped by the browser. The handler asks first.
 *   - `mounting` says the editor's selection is not yet the reader's: a
 *     WYSIWYG editor before its content load, or either editor before its
 *     mount/show caret restore has run.
 *
 * @coordinates-with selection.ts — the handlers
 * @coordinates-with stores/editorStore.ts — focused editor instances
 * @coordinates-with stores/uiStore.ts — sourceMode breaks a tie between registrations
 * @coordinates-with utils/markdownPipeline/index.ts — parseMarkdown / serializeMarkdown
 * @coordinates-with services/ime/compositionWriteGate.ts — WYSIWYG composition state
 * @coordinates-with utils/imeGuard.ts — Source composition state
 * @coordinates-with services/agentJournal/collectors/wysiwyg/wysiwygCollector.ts — the apply capture
 * @coordinates-with services/editor/contentApplied.ts — whether the WYSIWYG load ran
 * @coordinates-with services/editor/caretRestorePending.ts — whether the caret restore ran
 * @module services/mcpBridge/v2/selectionSurface
 */
import type { Editor as TiptapEditor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import type { EditorView as CMView } from "@codemirror/view";
import { useUIStore } from "@/stores/uiStore";
import { useEditorStore } from "@/stores/editorStore";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { getSerializeOptions } from "@/plugins/toolbarActions/wysiwygAdapterUtils";
import { isCompositionInProgress } from "@/services/ime/compositionWriteGate";
import { isCodeMirrorComposing, isCodeMirrorInCompositionGrace } from "@/utils/imeGuard";
import { hasContentApplied } from "@/services/editor/contentApplied";
import { isCaretRestorePending } from "@/services/editor/caretRestorePending";
import { captureWysiwygApply } from "@/services/agentJournal/collectors/wysiwyg/wysiwygCollector";
import type { WysiwygApplyCapture } from "@/services/agentJournal/collectors/wysiwyg/wysiwygCertificate";
import type { ExactChange } from "@/services/agentJournal/selectionCertificate";
import { composingRefusal } from "./liveEditor";
import type { V2Error } from "./types";

/** Which position space a selection's `range` lives in. */
type SelectionMode = "wysiwyg" | "source";

/** The focused editor's selection, in either editing mode. */
export interface SelectionSurface {
  mode: SelectionMode;
  /** The selection's bounds: PM positions in WYSIWYG, character offsets in Source. */
  range(): { from: number; to: number };
  /**
   * Whether the editor is still mounting: it has not received its document
   * (WYSIWYG) or its mount/show caret restore has not run. Its selection is
   * then not one the reader placed.
   */
  mounting(): boolean;
  /** The selected text; empty for a collapsed selection. */
  selectedText(): string;
  /** The whole document as the editor holds it now. */
  documentText(): string;
  /** BUSY while an IME composition owns part of the editor; otherwise `null`. */
  writeRefusal(): V2Error | null;
  /**
   * Replace the selection with `content` (an empty string deletes it).
   * Throws when `writeRefusal()` would refuse.
   */
  replaceSelection(content: string): void;
  /** Whether `replaceSelection(content)` would change the document; `false` only when provably not. */
  wouldChange(content: string): boolean;
  /** The exact change `replaceSelection(content)` makes, in the editor's text offsets; `null` in WYSIWYG, whose change is known only after the apply. */
  exactChange(content: string): ExactChange | null;
  /** Run `apply` (the replacement and its flush) and what the editor's provenance collector saw of it; `null` in Source or when nothing reported. */
  captureApply<T>(apply: () => T): { value: T; capture: WysiwygApplyCapture | null };
}

/** Fail loudly if a caller replaces without asking `writeRefusal` first. */
function assertNotComposing(composing: boolean): void {
  if (composing) {
    throw new Error("replaceSelection: an IME composition is in progress; ask writeRefusal first");
  }
}

/**
 * Heuristic — does this string look like it carries markdown structure?
 * Used to decide whether a replacement should round-trip through the
 * parser (markdown content) or be inserted as a literal text node (plain
 * content, where the parser would lose trailing whitespace).
 */
function looksLikeMarkdown(content: string): boolean {
  // Block-level structure: blank lines, headings, lists, blockquotes,
  // fences, thematic breaks, indented blocks.
  if (/\n\n/.test(content)) return true;
  if (/^(?:#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|~~~|---|\t)/m.test(content)) {
    return true;
  }
  // Inline markers — strong/code/link/image/strikethrough.
  if (/(\*\*|__|`|\[[^\]]*\]\(|!\[|~~)/.test(content)) return true;
  // Single-marker emphasis — paired `*foo*`. Underscore is intentionally
  // not detected here: `snake_case` is a common false-positive in plain
  // text. Use `**bold**` or `*italic*` for emphasis intent.
  return /\*[^\s*][^*]*\*/.test(content);
}

/** Serialize the current PM selection slice as markdown. */
function tiptapSelectionText(editor: TiptapEditor): string {
  const { from, to } = editor.state.selection;
  if (from === to) return "";
  const slice = editor.state.doc.slice(from, to);
  const schema = editor.state.schema;
  // A doc node cannot hold inline content directly. If the slice is
  // inline (text or marks), wrap it in a paragraph so the serializer
  // sees a valid tree.
  const firstChild = slice.content.firstChild;
  const wrapped =
    firstChild?.isInline && schema.nodes.paragraph
      ? schema.topNodeType.create(null, [schema.nodes.paragraph.create(null, slice.content)])
      : schema.topNodeType.create(null, slice.content);
  const out = serializeMarkdown(schema, wrapped, getSerializeOptions());
  // Drop the single trailing newline the serializer always adds as a doc
  // terminator. Real hard breaks inside the slice survive.
  return out.endsWith("\n") ? out.slice(0, -1) : out;
}

/** The transaction that replaces the current PM selection with parsed markdown; not dispatched. */
function tiptapReplacement(editor: TiptapEditor, content: string): Transaction {
  const { from, to } = editor.state.selection;
  const schema = editor.state.schema;
  const $from = editor.state.doc.resolve(from);
  const $to = editor.state.doc.resolve(to);
  const sameTextblock = $from.sameParent($to) && $from.parent.isTextblock;
  const tr = editor.state.tr;

  if (content.length === 0) return tr.deleteRange(from, to);
  if (sameTextblock && !looksLikeMarkdown(content)) {
    // Plain inline text: insert as a literal text node so trailing /
    // leading whitespace and naked characters round-trip exactly.
    return tr.replaceWith(from, to, schema.text(content));
  }
  const parsed = parseMarkdown(schema, content, {
    preserveLineBreaks: getSerializeOptions().preserveLineBreaks,
  });
  // parseMarkdown wraps inline content in a paragraph. When the
  // selection is within a single textblock, that wrapper would split
  // the host paragraph — strip it. For block-spanning ranges, keep
  // the block structure.
  const onlyChild = parsed.content.firstChild;
  const insertion =
    sameTextblock && parsed.content.childCount === 1 && onlyChild?.isTextblock
      ? onlyChild.content
      : parsed.content;
  return tr.replaceWith(from, to, insertion);
}

/** Replace the current PM selection with parsed markdown. */
function replaceTiptapSelection(editor: TiptapEditor, content: string): void {
  assertNotComposing(isCompositionInProgress(editor.view));
  editor.view.dispatch(tiptapReplacement(editor, content).setMeta("addToHistory", true));
}

/** Whether replacing the PM selection with `content` would change the document; a build that throws is a change. */
function tiptapWouldChange(editor: TiptapEditor, content: string): boolean {
  try {
    return !tiptapReplacement(editor, content).doc.eq(editor.state.doc);
  } catch {
    return true;
  }
}

function wysiwygSurface(editor: TiptapEditor): SelectionSurface {
  return {
    mode: "wysiwyg",
    range: () => {
      const { from, to } = editor.state.selection;
      return { from, to };
    },
    mounting: () => !hasContentApplied(editor) || isCaretRestorePending(editor),
    selectedText: () => tiptapSelectionText(editor),
    documentText: () =>
      serializeMarkdown(editor.state.schema, editor.state.doc, getSerializeOptions()),
    writeRefusal: () => (isCompositionInProgress(editor.view) ? composingRefusal() : null),
    replaceSelection: (content) => replaceTiptapSelection(editor, content),
    wouldChange: (content) => tiptapWouldChange(editor, content),
    exactChange: () => null,
    captureApply: (apply) => captureWysiwygApply(editor, apply),
  };
}

function sourceSurface(view: CMView): SelectionSurface {
  const range = () => {
    const { from, to } = view.state.selection.main;
    return { from, to };
  };
  const composing = () => isCodeMirrorComposing(view) || isCodeMirrorInCompositionGrace(view);
  const selectedText = () => {
    const { from, to } = range();
    return from === to ? "" : view.state.sliceDoc(from, to);
  };
  /** The text CodeMirror inserts for `content`: its line breaks become LF. */
  const inserted = (content: string) => view.state.toText(content).toString();
  return {
    mode: "source",
    range,
    mounting: () => isCaretRestorePending(view),
    selectedText,
    documentText: () => view.state.doc.toString(),
    writeRefusal: () => (composing() ? composingRefusal() : null),
    replaceSelection: (content) => {
      assertNotComposing(composing());
      const { from, to } = range();
      const insert = inserted(content);
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length },
      });
    },
    wouldChange: (content) => inserted(content) !== selectedText(),
    exactChange: (content) => ({ ...range(), insert: inserted(content) }),
    captureApply: (apply) => ({ value: apply(), capture: null }),
  };
}

/**
 * The live editing surface of the focused tab, or the `NO_EDITOR` refusal:
 * the editor registered for `focusedTabId` (a destroyed WYSIWYG editor does
 * not count). An editor registers only while its pane is focused and
 * visible, so this finds a YAML SourcePane or either pane of a split, which
 * the window's `sourceMode` does not describe. Both registered for the tab
 * (a pane hand-over in progress): `sourceMode` decides.
 */
export function resolveSelectionSurface(focusedTabId: string): SelectionSurface | V2Error {
  const { active } = useEditorStore.getState();
  const view = active.activeSourceTabId === focusedTabId ? active.activeSourceView : null;
  const wysiwyg = active.activeWysiwygTabId === focusedTabId ? active.activeWysiwygEditor : null;
  const editor = wysiwyg && !wysiwyg.isDestroyed ? wysiwyg : null;
  if (view && (!editor || useUIStore.getState().sourceMode)) return sourceSurface(view);
  if (editor) return wysiwygSurface(editor);
  return { error: "NO_EDITOR", message: "No active editor for the focused tab" };
}
