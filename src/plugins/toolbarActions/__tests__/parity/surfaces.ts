/**
 * Real editing surfaces for the behavioral parity harness.
 *
 * Purpose: run one toolbar action against BOTH editing surfaces — a real Tiptap
 * editor built from the production extension set, and a real CodeMirror view —
 * starting from the same markdown and the same logical selection, and return the
 * markdown each produced.
 *
 * Nothing here is mocked. That is the point: `wysiwygAdapter.test.ts` stubs
 * `expandedToggleMark` and every node action to return `true`, so it verifies
 * the switch routes an action, never that the action does anything. The two
 * adapters must agree on OUTCOMES, which only real surfaces can show.
 *
 * Selections are specified as a plain substring rather than an offset, because
 * the two surfaces hold different text: source mode holds raw markdown
 * (`> quoted`), WYSIWYG holds the parsed document (`quoted`, inside a
 * blockquote node). A plain word that appears in both is the one selection
 * specification both surfaces can honour.
 *
 * @coordinates-with ../../wysiwygAdapter.ts — performWysiwygToolbarAction
 * @coordinates-with ../../sourceAdapter.ts — performSourceToolbarAction
 * @coordinates-with @/services/assembly/tiptapExtensions — the production composition
 * @module plugins/toolbarActions/__tests__/parity/surfaces
 */
import { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createTiptapExtensions } from "@/services/assembly/tiptapExtensions";
import { parseMarkdown, serializeMarkdown } from "@/utils/markdownPipeline";
import { performWysiwygToolbarAction, setWysiwygHeadingLevel } from "../../wysiwygAdapter";
import { performSourceToolbarAction, setSourceHeadingLevel } from "../../sourceAdapter";
import type { SourceToolbarContext, WysiwygToolbarContext } from "../../types";

/**
 * jsdom gap: `getClientRects` and `getBoundingClientRect` exist on `Element`
 * but on neither `Range` nor `Text` (verified against this jsdom build).
 * ProseMirror's `coordsAtPos` measures a `Range` while re-resolving a selection
 * after a list or blockquote transform, so without these stubs real product code
 * throws `target.getClientRects is not a function` for reasons that have nothing
 * to do with the behavior under test.
 *
 * Scoped to this harness rather than added to `src/test/setup.ts`: a global
 * layout stub would silently change what every other suite observes. The rects
 * are empty because no parity assertion reads geometry — only that the
 * transform completed.
 */
function installLayoutStubs(): void {
  const emptyList = Object.assign([], { item: () => null }) as unknown as DOMRectList;
  const zeroRect = (): DOMRect =>
    ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
  for (const proto of [globalThis.Range?.prototype, globalThis.Text?.prototype, globalThis.Element?.prototype]) {
    if (!proto) continue;
    const target = proto as unknown as Record<string, unknown>;
    if (typeof target.getClientRects !== "function") target.getClientRects = (): DOMRectList => emptyList;
    if (typeof target.getBoundingClientRect !== "function") target.getBoundingClientRect = zeroRect;
  }
}

installLayoutStubs();

/** How to place the selection, stated once for both surfaces. */
export interface Target {
  /** Select this substring. */
  select?: string;
  /** Place a collapsed cursor at the start of this substring. */
  caret?: string;
}

export interface SurfaceResult {
  /** Whether the adapter accepted the action for dispatch. */
  accepted: boolean;
  /** The markdown the surface holds afterwards. */
  markdown: string;
  /** Set when the surface threw rather than returning. */
  error?: string;
}

/** Locate a substring inside a ProseMirror doc, in document coordinates. */
function findRange(doc: PMNode, needle: string): { from: number; to: number } | null {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText) return true;
    const index = (node.text ?? "").indexOf(needle);
    if (index !== -1) found = { from: pos + index, to: pos + index + needle.length };
    return !found;
  });
  return found;
}

/** Heading actions arrive as `heading:N`; both adapters route them separately. */
function headingLevel(action: string): number | null {
  const match = /^heading:(\d)$/.exec(action);
  return match ? Number(match[1]) : null;
}

/**
 * One shared editor for the whole suite.
 *
 * Booting the production composition (77 extensions) costs ~100ms, which at one
 * boot per case dominated the run. Content and selection are replaced per case,
 * so cases stay isolated in everything the parity assertions read. Undo history
 * does persist across cases — acceptable only because no parity case exercises
 * undo/redo; add a fresh-editor path before covering those.
 */
let shared: { editor: Editor; element: HTMLElement } | null = null;

function sharedEditor(): Editor {
  if (!shared) {
    const element = document.createElement("div");
    document.body.appendChild(element);
    shared = { editor: new Editor({ element, extensions: createTiptapExtensions(), content: "" }), element };
  }
  return shared.editor;
}

/** Tear the shared editor down; call from an `afterAll`. */
export function disposeSurfaces(): void {
  if (!shared) return;
  shared.editor.destroy();
  shared.element.remove();
  shared = null;
}

/** Run an action against a real Tiptap editor and return the resulting markdown. */
export function runOnWysiwyg(markdown: string, target: Target, action: string): SurfaceResult {
  const editor = sharedEditor();
  try {
    const parsed = parseMarkdown(editor.schema, markdown);
    editor.commands.setContent(parsed.toJSON());

    const needle = target.select ?? target.caret;
    if (needle) {
      const range = findRange(editor.state.doc, needle);
      if (!range) return { accepted: false, markdown, error: `target ${JSON.stringify(needle)} not found in WYSIWYG doc` };
      editor.commands.setTextSelection(target.caret ? { from: range.from, to: range.from } : range);
    }

    const context: WysiwygToolbarContext = {
      surface: "wysiwyg",
      view: editor.view,
      editor,
      context: null,
    };
    const level = headingLevel(action);
    const accepted = level === null
      ? performWysiwygToolbarAction(action, context)
      : setWysiwygHeadingLevel(context, level);
    return { accepted, markdown: serializeMarkdown(editor.schema, editor.state.doc) };
  } catch (e) {
    return { accepted: false, markdown, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  }
}

/** Run an action against a real CodeMirror view and return the resulting text. */
export function runOnSource(markdown: string, target: Target, action: string): SurfaceResult {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const needle = target.select ?? target.caret;
  const index = needle ? markdown.indexOf(needle) : -1;
  if (needle && index === -1) {
    parent.remove();
    return { accepted: false, markdown, error: `target ${JSON.stringify(needle)} not found in source text` };
  }
  const anchor = needle ? index : 0;
  const head = target.select && needle ? index + needle.length : anchor;

  const view = new EditorView({
    state: EditorState.create({
      doc: markdown,
      selection: EditorSelection.create([EditorSelection.range(anchor, head)]),
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent,
  });
  try {
    const context: SourceToolbarContext = { surface: "source", view, context: null };
    const level = headingLevel(action);
    const accepted = level === null
      ? performSourceToolbarAction(action, context)
      : setSourceHeadingLevel(context, level);
    return { accepted, markdown: view.state.doc.toString() };
  } catch (e) {
    return { accepted: false, markdown, error: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };
  } finally {
    view.destroy();
    parent.remove();
  }
}
